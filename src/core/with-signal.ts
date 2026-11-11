import type {RoutesClientExtras} from './create-client.js'

/** Combine cancellation sources while preserving a single signal unchanged. */
export function combineSignals(...signals: Array<AbortSignal | undefined>): AbortSignal | undefined {
  const activeSignals = [...new Set(signals.filter((signal): signal is AbortSignal => signal !== undefined))]
  if (activeSignals.length === 0) return undefined
  if (activeSignals.length === 1) return activeSignals[0]
  return AbortSignal.any(activeSignals)
}

/**
 * Bind a cancellation signal to a routes client so the requests it issues
 * abort in flight.
 *
 * Extension methods receive their signal as a per-call option (e.g.
 * `addOn.createAndWait(app, body, {signal})`) rather than through the client,
 * so the signal reaches `wait()`/`throwIfAborted()` checkpoints but not the
 * in-flight request unless it's pushed onto the client. This returns a derived,
 * signal-bearing client (the original is never mutated) — or the client
 * unchanged when no signal is supplied, so a signal-less call stays a no-op.
 *
 * Signals do not combine: `withOptions` is last-wins, so bind a combined signal
 * when both client-scoped and per-call cancellation must reach the request.
 */
export function withSignal<T>(client: RoutesClientExtras<T> & T, signal?: AbortSignal): RoutesClientExtras<T> & T {
  return signal ? client.withOptions({signal}) : client
}
