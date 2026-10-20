import type {RoutesClientExtras} from './create-client.js'

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
 */
export function withSignal<T>(client: RoutesClientExtras<T> & T, signal?: AbortSignal): RoutesClientExtras<T> & T {
  return signal ? client.withOptions({signal}) : client
}
