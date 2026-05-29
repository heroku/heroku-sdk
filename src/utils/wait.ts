/**
 * Promise-based delay that respects an optional AbortSignal.
 *
 * Resolves after `ms` milliseconds. If `signal` is provided and is
 * (or becomes) aborted, the promise rejects with `signal.reason`
 * (or `new Error('Aborted')` if `reason` is unset) and clears the
 * pending timer.
 *
 * Used by polling loops in resource extensions (e.g. `addOn.createAndWait`,
 * `pipelinePromotion.promote`) to space out poll requests while staying
 * responsive to cancellation.
 *
 * @param ms Milliseconds to wait before resolving.
 * @param signal Optional AbortSignal to cancel the wait early.
 */
export function wait(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    function onAbort() {
      clearTimeout(timer)
      reject(signal!.reason ?? new Error('Aborted'))
    }

    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)

    if (signal) {
      if (signal.aborted) {
        clearTimeout(timer)
        reject(signal.reason ?? new Error('Aborted'))
        return
      }

      signal.addEventListener('abort', onAbort, {once: true})
    }
  })
}
