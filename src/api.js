import { fetch, WebSocket, EventSource, FormData } from 'undici'
import { webcrypto } from 'node:crypto'
import { app } from 'electron'
import { join } from 'node:path'
import { createServer } from 'node:http'
import { access, unlink } from 'node:fs/promises'
import { Readable } from 'node:stream'
import { ReadableStream } from 'node:stream/web'
import { inspect, promisify } from 'node:util'
import Error from '@noop-inc/foundation/lib/Error.js'
import { setTimeout as wait } from 'node:timers/promises'
import { settlePromises } from '@noop-inc/foundation/lib/Helpers.js'

const mainWindowViteDevServerURL = MAIN_WINDOW_VITE_DEV_SERVER_URL // eslint-disable-line no-undef
const packaged = (!mainWindowViteDevServerURL && app.isPackaged)

const logHandler = (...messages) =>
  console[(messages[0].event.includes('.error') || messages[0].error) ? 'error' : 'log'](
    ...messages.map(message =>
      inspect(
        JSON.parse(JSON.stringify(message)),
        { breakLength: 10000, colors: !packaged, compact: true, depth: null }
      )
    )
  )

export const storage = {}

export const setStorage = nextStorage => {
  Object.assign(storage, nextStorage)
}

const bufferToHex = buffer => {
  return Array.from(new Uint8Array(buffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
}

const sha256 = async text => {
  const encoder = new TextEncoder()
  const hashBuffer = await webcrypto.subtle.digest('SHA-256', encoder.encode(text))
  return bufferToHex(hashBuffer)
}

const hmacSha256 = async (text, secret = storage.secret) => {
  const encoder = new TextEncoder()
  const algorithm = { name: 'HMAC', hash: 'SHA-256' }
  const key = await webcrypto.subtle.importKey('raw', encoder.encode(secret), algorithm, false, ['sign', 'verify'])
  const signature = await webcrypto.subtle.sign(algorithm.name, key, encoder.encode(text))
  return bufferToHex(signature)
}

const normalizeArguments = (args, defaults = []) => {
  const normalized = {}
  if (((typeof args[0]) === 'object') && ('path' in args[0])) {
    for (const [key, value] of Object.entries(args[0])) {
      normalized[key] = value
    }
  } else {
    for (let i = 0; i < args.length; i++) {
      const currentArg = args[i]
      const [defaultKey] = defaults[i]
      normalized[defaultKey] = currentArg
    }
  }
  for (const [key, value] of defaults) {
    normalized[key] = normalized[key] || value
  }
  return normalized
}

const prepareSign = async (...args) => {
  let { path, method, body, settings } = normalizeArguments(args, [['path'], ['method', 'GET'], ['body', null], ['settings', {}]])
  if (!body && !['GET', 'CONNECT'].includes(method)) body = {}
  const local = !!((path === '/local') || path.startsWith('/local/'))
  const base = local ? 'https://workshop.local.noop.app:44452' : storage.apiBase
  const url = new URL(path, base)
  const sign =
    !local &&
    (url.origin === base) &&
    storage.token &&
    storage.secret &&
    !((method === 'GET') && ['/_health', '/metadata', '/workshop/logs/events'].includes(url.pathname)) &&
    !((method === 'POST') && ['/sessions'].includes(url.pathname))
  if (method === 'CONNECT') url.protocol = url.protocol.replace('http', 'ws')
  if (settings.query && ((typeof settings.query) === 'object')) {
    for (const [key, value] of Object.entries(settings.query)) {
      url.searchParams.set(key, value)
    }
  }
  const options = { method, headers: settings.headers || {} }
  if (body && !(body instanceof FormData) && !(body instanceof ReadableStream)) {
    body = JSON.stringify(body)
    options.headers['content-type'] = 'application/json'
  }
  if (body) options.body = body
  if (settings.duplex) options.duplex = settings.duplex
  if (sign) {
    const date = Date.now()
    const token = storage.token
    const canonical = [method, url.host, url.pathname, token, date]
    if ((typeof options.body) === 'string') canonical.push(await sha256(options.body))
    const hash = await sha256(canonical.join('\n'))
    const signature = await hmacSha256(hash)
    Object.assign(options.headers, {
      'x-noop-date': date,
      'x-noop-token': token,
      'x-noop-signature': signature
    })
  }
  if (options.headers.host) options.headers.host = url.host
  return { url, options }
}

const requestSign = async (...args) => {
  const { url, options } = await prepareSign(...args)
  return [url.href, options]
}

const eventsSign = async (...args) => {
  const { url, options } = await prepareSign(...args)
  for (const [key, value] of Object.entries(options.headers)) {
    if (key.startsWith('x-noop-')) {
      url.searchParams.set(key, value)
      delete options.headers[key]
    }
  }
  if (!Object.keys(options.headers).length) delete options.headers
  return [url.href, options]
}

const handleRequest = async (...args) => {
  const [href, options] = await requestSign(...args)
  const response = await fetch(href, options)
  const contentType = response.headers.get('content-type')
  if (!response.ok) {
    if (contentType === 'application/json') throw await response.json()
    let message
    try {
      message = await response.text()
      message = JSON.parse(message)
    } catch (error) {
      // swallow for now...
    }
    if ((typeof message) === 'object') throw message
    /* eslint-disable no-throw-literal */
    throw {
      code: 'Error',
      message,
      statusCode: response.status
    }
    /* eslint-enable no-throw-literal */
  }
  const raw = args[0]?.settings?.raw || args.at(-1)?.raw
  if (raw) return response
  if (contentType === 'application/json') return await response.json()
  let content
  try {
    content = await response.text()
    content = JSON.parse(content)
  } catch (error) {
    // swallow for now...
  }
  return content
}

const handleEvents = async (...args) => {
  const [href, options] = await eventsSign(...args)
  const connection = (options.method === 'CONNECT')
    ? new WebSocket(href)
    : new EventSource(href)
  try {
    return await new Promise((resolve, reject) => {
      const cleanup = () => {
        connection.removeEventListener('open', handleOpen)
        connection.removeEventListener('error', handleError)
      }
      const handleOpen = () => {
        cleanup()
        resolve(connection)
      }
      const handleError = event => {
        cleanup()
        reject(event)
      }
      try {
        connection.addEventListener('open', handleOpen)
        connection.addEventListener('error', handleError)
      } catch (error) {
        cleanup()
        reject(error)
      }
    })
  } catch (error) {
    try {
      throw error
    } finally {
      connection.close()
    }
  }
}

export const get = async (...args) => {
  const normalized = normalizeArguments(args, [['path'], ['settings']])
  return await handleRequest({ ...normalized, method: 'GET' })
}

export const put = async (...args) => {
  const normalized = normalizeArguments(args, [['path'], ['body'], ['settings']])
  return await handleRequest({ ...normalized, method: 'PUT' })
}

export const post = async (...args) => {
  const normalized = normalizeArguments(args, [['path'], ['body'], ['settings']])
  return await handleRequest({ ...normalized, method: 'POST' })
}

export const del = async (...args) => {
  const normalized = normalizeArguments(args, [['path'], ['body'], ['settings']])
  return await handleRequest({ ...normalized, method: 'DELETE' })
}

export const connect = async (...args) => {
  const normalized = normalizeArguments(args, [['path'], ['settings']])
  return await handleEvents({ ...normalized, method: 'CONNECT' })
}

export const eventsource = async (...args) => {
  const normalized = normalizeArguments(args, [['path'], ['settings']])
  return await handleEvents({ ...normalized, method: 'GET' })
}

export const api = {
  get,
  post,
  put,
  del,
  connect,
  eventsource
}

export class Proxy {
  sockets
  server

  get socketPath () {
    const userData = app.getPath('userData')
    const dataDir = join(userData, 'data')
    const socketPath = join(dataDir, 'noop.sock')
    return socketPath
  }

  async start () {
    logHandler({ event: 'proxy.server.start' })
    if (this.server) {
      await this.stop()
    } else {
      await this.cleanup()
    }
    this.sockets = new Set()
    this.server = createServer(async (req, res) => await this.handleProxyRequest(req, res))
    this.server.on('error', error => {
      logHandler({ event: 'proxy.server.error', error: Error.wrap(error) })
    })
    await promisify(this.server.listen.bind(this.server))(this.socketPath)
    logHandler({ event: 'proxy.server.started', socketPath: this.socketPath })
  }

  async handleProxyRequest (req, res) {
    logHandler({ event: 'proxy.server.request' })
    this.handleProxySocket(req.socket)
    this.handleProxySocket(res.socket)
    try {
      const path = req.url
      const method = req.method
      const settings = { headers: { ...req.headers } }
      let body = null
      if (!['GET', 'HEAD'].includes(req.method)) {
        if (req.headers['content-type'] === 'application/json') {
          body = await new Promise((resolve, reject) => {
            let rawBody = ''
            const cleanup = () => {
              req.off('data', dataHandler)
              req.off('error', errorHandler)
              req.off('end', endHandler)
            }
            const dataHandler = chunk => {
              rawBody += chunk.toString()
            }
            const errorHandler = error => {
              cleanup()
              reject(error)
            }
            const endHandler = () => {
              cleanup()
              try {
                resolve(JSON.parse(rawBody))
              } catch (error) {
                errorHandler(error)
              }
            }
            req.on('data', dataHandler)
            req.on('error', errorHandler)
            req.on('end', endHandler)
          })
        } else {
          body = Readable.toWeb(req)
          settings.duplex = 'half'
        }
      }

      const proxySign =
        (method === 'GET') &&
        (
          (req.headers.accept === 'text/event-stream') ||
          Object.entries(req.headers).some(([key, value]) => key?.includes('websocket') || value?.includes('websocket'))
        )
          ? eventsSign
          : requestSign

      const [href, options] = await proxySign({ path, method, body, settings })
      const repsonse = await fetch(href, options)
      res.writeHead(repsonse.status, Object.fromEntries(repsonse.headers.entries()))
      Readable.fromWeb(repsonse.body).pipe(res)
    } catch (error) {
      const wrapped = Error.wrap(error)
      logHandler({ event: 'proxy.request.error', error: wrapped })
      if (!res.headersSent) {
        const stringified = JSON.stringify(wrapped)
        const parsed = JSON.parsed(stringified)
        const statusCode = parsed.statusCode || 500
        const headers = {
          'content-type': 'application/json',
          'content-length': stringified.length
        }
        res.writeHead(statusCode, headers)
        res.end(stringified)
      }
    }
  }

  handleProxySocket (socket) {
    if (!this.sockets.has(socket)) {
      const sockets = this.sockets
      sockets.add(socket)
      // logHandler({ event: 'proxy.server.socket' })
      const cleanup = error => {
        socket.off('end', handleEnd)
        socket.off('error', handleError)
        if (error) {
          logHandler({ event: 'proxy.socket.error', error: Error.wrap(error) })
        }
        if (!socket.destroyed) socket.destroy()
        sockets.delete(socket)
      }
      const handleEnd = () => {
        cleanup()
      }
      const handleError = error => {
        cleanup(error)
      }
      const handleClose = () => {
        // logHandler({ event: 'proxy.socket.closed' })
        sockets.delete(socket)
      }
      socket.once('end', handleEnd)
      socket.once('error', handleError)
      socket.once('close', handleClose)
    }
  }

  async stop () {
    if (this.server) {
      const server = this.server
      const sockets = this.sockets
      logHandler({ event: 'proxy.server.close', sockets: sockets?.size })

      const closeServer = async () => {
        try {
          if (server) await promisify(server.close.bind(server))()
        } catch (error) {
          if (error.code !== 'ERR_SERVER_NOT_RUNNING') throw error
        }
      }

      const destroySocket = async socket => {
        const ac = new AbortController()
        const handleTimeout = async () => {
          try {
            await wait(1_000, null, { ref: false, signal: ac.signal })
          } catch (error) {
            if (error.code !== 'ABORT_ERR') throw error
          } finally {
            ac.abort()
          }
        }
        const handleEnd = async () => {
          try {
            if (!socket.destroyed) await promisify(socket.end.bind(socket))()
          } finally {
            ac.abort()
          }
        }
        try {
          await Promise.all([
            handleTimeout(),
            handleEnd()
          ])
        } finally {
          try {
            if (!socket.destroyed) socket.destroy()
          } finally {
            ac.abort()
          }
        }
      }

      const { errors: stopErrors } = await settlePromises([
        ...[...sockets].map(async socket => await destroySocket(socket))
      ])
      const { errors: closeErrors } = await settlePromises([
        closeServer(),
        ...[...sockets].map(async socket => await destroySocket(socket))
      ])
      const errors = [...stopErrors, ...closeErrors].map(error => Error.wrap(error))

      if (errors?.length) logHandler({ event: 'proxy.close.error', errors })

      logHandler({ event: 'proxy.server.closed', sockets: sockets?.size })
      await this.cleanup()
      if (this.server === server) {
        this.sockets = null
        this.server = null
      }
    } else {
      logHandler({ event: 'proxy.server.close.skip' })
    }
  }

  async cleanup () {
    try {
      await access(this.socketPath)
      await unlink(this.socketPath)
    } catch (error) {
      // swallow...
    }
  }
}
