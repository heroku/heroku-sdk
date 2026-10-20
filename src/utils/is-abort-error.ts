/**
 * True when `error` represents a cancelled or timed-out request.
 *
 * `fetch`/`ky` reject an aborted request with a `DOMException` named
 * `AbortError`, and a signal from `AbortSignal.timeout()` rejects with one named
 * `TimeoutError`; `signal.throwIfAborted()` throws the same `AbortError` shape by
 * default. Used so soft-failure handling (broad `.catch` defaults, retry loops)
 * can let cancellation propagate instead of swallowing it or treating it as a
 * retryable failure.
 *
 * Note: a caller that aborts with a custom reason (`controller.abort(reason)`)
 * whose `name` is neither of these will not be detected here — detect those via
 * the signal's `aborted` flag at the call site when one is available.
 */
export function isAbortError(error: unknown): boolean {
  return (
    (error instanceof Error || error instanceof DOMException)
    && (error.name === 'AbortError' || error.name === 'TimeoutError')
  )
}
