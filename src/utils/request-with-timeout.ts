import {wait} from './wait.js'

const MAX_TIMER_DELAY_MS = 2_147_483_647

/**
 * Run a request with a request-local abort signal, optional deadline, and
 * caller cancellation. A request that ignores abort still cannot hold up the
 * caller, and any late rejection remains handled by the race.
 */
export async function requestWithTimeout<T, TimeoutValue>(
  request: (signal: AbortSignal) => Promise<T>,
  options: {signal?: AbortSignal; timeoutMs?: number; timeoutValue: TimeoutValue},
): Promise<T | TimeoutValue> {
  const {signal, timeoutMs, timeoutValue} = options
  signal?.throwIfAborted()

  if (timeoutMs !== undefined && timeoutMs <= 0) return timeoutValue

  const controller = new AbortController()
  const deadline = timeoutMs === undefined ? undefined : Date.now() + timeoutMs
  let timer: ReturnType<typeof setTimeout> | undefined
  let abortHandler: (() => void) | undefined

  const timeoutPromise = deadline === undefined
    ? undefined
    : new Promise<TimeoutValue>(resolve => {
      const checkDeadline = () => {
        const remainingMs = deadline - Date.now()
        if (remainingMs <= 0) {
          resolve(timeoutValue)
          controller.abort()
          return
        }

        timer = setTimeout(checkDeadline, Math.min(remainingMs, MAX_TIMER_DELAY_MS))
      }

      checkDeadline()
    })

  let abortPromise: Promise<never> | undefined
  if (signal) {
    abortPromise = new Promise((_, reject) => {
      const onAbort = () => {
        const {reason} = signal
        // Settle the caller's cancellation before aborting the request: abort
        // listeners may synchronously reject the request with a different error.
        reject(reason ?? new Error('Aborted'))
        controller.abort(reason)
      }

      abortHandler = onAbort

      signal.addEventListener('abort', abortHandler, {once: true})
      if (signal.aborted) abortHandler()
    })
  }

  try {
    // Defer invocation so Promise.race observes abort and timeout settlements
    // before request code can synchronously abort or reject.
    const requestPromise = Promise.resolve().then(() => {
      controller.signal.throwIfAborted()
      return request(controller.signal)
    })

    const promises: Array<Promise<T | TimeoutValue>> = []
    if (abortPromise) promises.push(abortPromise)
    if (timeoutPromise) promises.push(timeoutPromise)
    promises.push(requestPromise)
    return await Promise.race(promises)
  } finally {
    if (timer) clearTimeout(timer)
    if (signal && abortHandler) signal.removeEventListener('abort', abortHandler)
  }
}

/** Wait a full duration, chunking delays beyond the platform timer limit. */
/* eslint-disable no-await-in-loop */
export async function waitForDuration(ms: number, signal?: AbortSignal): Promise<void> {
  const deadline = performance.now() + Math.max(0, ms)
  while (true) {
    const remainingMs = deadline - performance.now()
    if (remainingMs <= 0) return

    await wait(Math.min(remainingMs, MAX_TIMER_DELAY_MS), signal)
  }
}
/* eslint-enable no-await-in-loop */
