import { Readable, Writable } from 'node:stream'
import { promisify } from 'node:util'

const isObject = object => object && ((typeof object) === 'object')

const isFunction = func => (typeof func) === 'function'

const isIterator = iterator => isFunction(iterator?.[Symbol.iterator])

const isAsyncIterator = asyncIterator => isFunction(asyncIterator?.[Symbol.asyncIterator])

const isLikelyWritable = writable =>
  (writable instanceof Writable) || isFunction(writable?.write)

const isLikelyReadable = readable =>
  (readable instanceof Readable) || !!(isFunction(readable?.read) && isFunction(readable?.pipe))

const streamCleanup = (stream, error) => {
  if (stream && (isLikelyReadable(stream) || isLikelyWritable(stream)) && !(stream.closed || stream.destroyed)) {
    // if (!error) {
    //   if (isLikelyWritable(stream) && !stream.writableFinished && !stream.errored) return false
    //   if (isLikelyReadable(stream) && !stream.readableEnded && !stream.errored) return false
    // }
    if ((typeof stream.destroy) === 'function') {
      stream.destroy(error)
    } else if ((typeof stream.end) === 'function') {
      stream.end()
    } else if ((typeof stream.close) === 'function') {
      stream.close()
    }
  }
}

// Util method for piping chains of streams together without using Node's native
// pipeline method. This alternative implimentation might be needed to
// circumvent implicit behavior baked into the native pipeline method
// which might be surfacing erroneous errors (i.e. premature close errors).
// Ideally this alternative implimentation should not be needed, and it should
// be removed from our code base in the future when we have a better understanding
// on edgecases involving native pipeline.
//
// TODO - Enhance further to more closely mirror the expected
// inputs/outputs of Node's native pipeline method
export const pipeline = (...streams) => {
  if (!isFunction(streams.at(-1))) throw new Error('pipeline callback missing')
  const callback = streams.pop()
  const { signal, end } = (
    isObject(streams.at(-1)) &&
    !isIterator(streams.at(-1)) &&
    !isAsyncIterator(streams.at(-1)) &&
    !isLikelyWritable(streams.at(-1)) &&
    !isLikelyReadable(streams.at(-1))
  )
    ? streams.pop()
    : {}
  const options = { signal, end }
  if (options.signal === undefined) options.signal = null
  if (options.end === undefined) options.end = true
  if (streams.length < 2) throw new Error('pipeline must be provided a source and a destination')
  const actuals = []
  const closed = new Array(streams.length).fill(false)
  const handlers = new Array(streams.length).fill({})
  let callbacked = false
  const wrapped = error => {
    cleanupAll(error)
    if (!callbacked) {
      callbacked = true
      callback(error)
    }
  }
  const cleanupAll = error => {
    if (options.signal) options.signal.removeEventListener('abort', abortHandler)
    for (const { cleanup } of handlers) {
      if (cleanup) cleanup(error)
    }
  }
  let aborted = false
  const abortHandler = () => {
    if (!aborted) {
      aborted = true
      wrapped(new Error('pipeline was aborted'))
    }
  }
  if (options.signal) {
    if (options.signal.aborted) return abortHandler()
    options.signal.addEventListener('abort', abortHandler, { once: true })
  }
  try {
    for (let idx = 0; idx < streams.length; idx++) {
      const prior = actuals[idx - 1]
      const current = streams[idx]
      const invoked = isFunction(current)
        ? current(...[prior, { signal: options.signal }].filter(Boolean))
        : current
      const actual = ((isAsyncIterator(invoked) || (!idx && isIterator(invoked))) && !isLikelyReadable(invoked) && (idx !== (streams.length - 1)))
        ? Readable.from(invoked)
        : invoked
      // if (!isAsyncIterator(actual) && !isPromise(actual)) {
      //   throw new Error('pipeline inputs must resolve to either an async interators or a promises')
      // }
      // TODO - properly handle inputs that resolve to promises
      actuals.push(actual)
      if ((isLikelyReadable(actual) || isLikelyWritable(actual)) && !(actual?.closed || actual?.destroyed)) {
        const errorHandler = error => wrapped(error)
        const closeHandler = () => {
          cleanup()
          closed[idx] = true
          if (closed.every(Boolean)) wrapped()
        }
        const cleanup = error => {
          actual.off('error', errorHandler)
          actual.off('close', closeHandler)
          actual.off('end', closeHandler)
          actual.off('finish', closeHandler)
          if (error && !((idx === (streams.length - 1)) && !options.end)) {
            streamCleanup(actual, error)
          }
        }
        actual.once('error', errorHandler)
        actual.once('close', closeHandler)
        actual.once('end', closeHandler)
        actual.once('finish', closeHandler)
        closed[idx] = ((idx === (streams.length - 1)) && !options.end) ? true : !!(actual?.closed || actual?.destroyed)
        handlers[idx] = { errorHandler, closeHandler, cleanup }
      } else {
        closed[idx] = true
        handlers[idx] = {}
      }
      if (idx && !isFunction(current)) {
        if (isLikelyWritable(actual)) {
          if (isLikelyReadable(prior)) {
            prior.pipe(actual, { end: (idx === (streams.length - 1)) ? options.end : true })
          } else {
            actual.write(prior)
          }
        } else {
          throw new Error('pipeline unable to forward data due to invalid arguments')
        }
      }
    }
    return actuals?.at(-1)
  } catch (error) {
    wrapped(error)
  } finally {
    if (closed.every(Boolean)) wrapped()
  }
}

export const promises = {
  pipeline: (...args) => promisify(pipeline)(...args)
}
