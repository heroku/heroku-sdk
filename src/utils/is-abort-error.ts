/**
 * True when `error` is the standard `AbortError` raised for a cancelled
 * request: `fetch`/`ky` reject an aborted request with a `DOMException` named
 * `AbortError`, and `signal.throwIfAborted()` throws the same shape by default.
 *
 * Used so soft-failure handling (broad `.catch` defaults, retry loops) can let
 * cancellation propagate instead of swallowing it or treating it as retryable.
 * Pair it with `signal?.aborted` at the call site to also catch a custom-reason
 * abort (`controller.abort(reason)`) or an `AbortSignal.timeout()` deadline.
 */
export function isAbortError(error: unknown): boolean {
  return (
    (error instanceof Error || error instanceof DOMException)
    && error.name === 'AbortError'
  )
}
