import { fetch, WebSocket, EventSource, FormData } from 'undici'
import { webcrypto } from 'node:crypto'
import { app } from 'electron'
import { join } from 'node:path'
import { createServer } from 'node:http'
import { access, unlink } from 'node:fs/promises'
import { Readable } from 'node:stream'
import { ReadableStream } from 'node:stream/web'
import { promises } from './stream.js'
import { setTimeout as wait } from 'node:timers/promises'
import { promisify } from 'node:util'

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

const hmacSha256 = async (text, secret) => {
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
  const local = !!((path === '/local') || path.startsWith('/local/') || (path === '/registry/prune'))
  const base = local ? 'https://workshop.local.noop.app:44452' : storage.apiBase
  const url = new URL(path, base)
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
  if (!local) {
    const date = Date.now()
    const token = storage.token
    const canonical = [method, url.host, url.pathname, token, date]
    if ((typeof options.body) === 'string') canonical.push(await sha256(options.body))
    const hash = await sha256(canonical.join('\n'))
    const signature = await hmacSha256(hash, storage.secret)
    Object.assign(options.headers, {
      'x-noop-date': date,
      'x-noop-token': token,
      'x-noop-signature': signature
    })
  }
  options.headers.host = url.host
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
    const message = await response.text()
    /* eslint-disable no-throw-literal */
    throw {
      code: 'Error',
      message,
      statusCode: response.status
    }
    /* eslint-enable no-throw-literal */
  }
  if (args[0]?.settings?.raw || args.at(-1)?.raw) return response
  if (contentType === 'application/json') return await response.json()
  return await response.text()
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
  return await handleRequest({ ...normalized, method: 'PUT' })
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

const userData = app.getPath('userData')
const dataDir = join(userData, 'data')
const socketPath = join(dataDir, 'noop.sock')

export const createProxyServer = async () => {
  try {
    await access(socketPath)
    await unlink(socketPath)
  } catch (error) {
    // swallow...
  }

  const controller = new AbortController()
  const { signal } = controller

  const sockets = new Set()
  const handleProxySockets = (req, res) => {
    sockets.add(req.socket)
    sockets.add(res.socket)
    req.socket.once('error', () => {
      sockets?.delete(req.socket)
      if (res.socket.destroyed) {
        res.socket.end(() => {
          if (!res.socket.destroyed) res.socket.destroy()
          sockets?.delete(res.socket)
        })
      }
    })
    res.socket.once('error', () => {
      sockets?.delete(res.socket)
      if (!req.socket.destroyed) {
        req.socket.end(() => {
          if (!req.socket.destroyed) req.socket.destroy()
          sockets?.delete(req.socket)
        })
      }
    })
  }

  const server = createServer(async (req, res) => {
    handleProxySockets(req, res)
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
    try {
      await promises.pipeline(Readable.fromWeb(repsonse.body), res, { signal, end: true })
    } catch (error) {
      if (!signal.aborted) throw error
    }
  })

  server.listen(socketPath, () => {
    console.log(`HTTP server listening on Unix socket: ${socketPath}`)
  })

  server.on('error', error => {
    console.error('Server error:', error)
  })

  return async () => {
    try {
      const stopServer = async () => {
        try {
          await promisify(server.close.bind(server))
        } catch (error) {
          if (error.code !== 'ERR_SERVER_NOT_RUNNING') throw error
        }
      }
      const serverStopped = stopServer()
      await Promise.all([
        ...[...sockets].map(async socket => {
          if (!socket.destroyed) {
            const endSocket = async () => {
              try {
                await promisify(socket.end.bind(socket))
              } catch (error) {
                if (error.code !== 'ERR_STREAM_ALREADY_FINISHED') throw error
              }
            }
            const ac = new AbortController()
            const signal = ac.signal
            await Promise.race([wait(1000, null, { signal }), endSocket()])
            ac.abort()
          }
          if (!socket.destroyed) {
            try {
              socket.destroy()
            } catch (error) {
              if (error.code !== 'ERR_STREAM_ALREADY_FINISHED') throw error
            }
          }
          sockets.delete(socket)
        }),
        // controller.abort(),
        serverStopped
      ])
    } finally {
      try {
        await access(socketPath)
        await unlink(socketPath)
      } catch (error) {
        // swallow...
      }
    }
  }
}
