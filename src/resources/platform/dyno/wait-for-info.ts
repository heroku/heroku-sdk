/* eslint-disable no-await-in-loop */
import type {Dyno} from '@heroku/types/3.sdk'

import {HerokuApiError, NotFoundError, RateLimitError} from '@heroku/heroku-fetch'

import type {ResourceCtx} from '../../../core/extend-resource.js'

import {wait} from '../../../utils/wait.js'

/**
 * Documented dyno states from the Platform API:
 * https://devcenter.heroku.com/articles/platform-api-reference#dyno
 *
 * Recommended for autocomplete in {@link WaitForInfoOptions.states},
 * which accepts any string at runtime — the platform does not commit
 * to a closed set, so the comparison is plain string equality.
 */
export type DynoState = 'crashed' | 'down' | 'idle' | 'starting' | 'up'

const DEFAULT_ATTEMPTS = 20
const DEFAULT_DELAY_MS = 1000

/**
 * Thrown by {@link waitForInfo} when `states` was set, the dyno was
 * reachable, but its `state` never matched within the configured
 * number of attempts. Carries the last observed dyno so callers can
 * branch on its state (e.g. distinguish a `crashed` dyno from one
 * stuck in `starting`).
 */
export class DynoNotReadyError extends Error {
  public readonly id = 'dyno_not_ready'

  constructor(
    public readonly dyno: Dyno,
    public readonly expectedStates: ReadonlyArray<string>,
    public readonly attempts: number,
  ) {
    super(`Dyno '${dyno.name}' did not reach state ${expectedStates.join('/')} `
      + `within ${attempts} attempts (last state: ${dyno.state}).`)
    this.name = 'DynoNotReadyError'
  }
}

export type WaitForInfoOptions = {
  /**
   * Maximum total number of `dyno.info` calls before giving up.
   * Defaults to 20. Each attempt is one info call; the delay
   * between attempts is {@link WaitForInfoOptions.delayMs}.
   */
  attempts?: number
  /**
   * Delay between attempts in milliseconds. Defaults to 1000.
   * On a 429 response, the platform's `Retry-After` header takes
   * precedence over this value for the next wait.
   */
  delayMs?: number
  /**
   * Fires after every successful `dyno.info` call, including ones
   * whose `state` does not yet match {@link WaitForInfoOptions.states}
   * and trigger another retry, AND for the final matching dyno
   * before it is returned. Use this to surface live state
   * transitions in a UI (e.g. a CLI spinner that updates
   * `starting → up`). Not called when an attempt errors (404, 429,
   * 503). Exceptions thrown from this callback propagate and end
   * the wait — there is no implicit catch.
   */
  onPoll?: (dyno: Dyno) => void
  signal?: AbortSignal
  /**
   * If set, only return when the dyno's `state` is one of these.
   * If omitted, the call returns on the first 2xx response
   * regardless of state — useful for racing past the post-creation
   * 404 window without waiting for the dyno to be runnable. The
   * recommended values are documented as {@link DynoState}; any
   * string is accepted.
   */
  states?: ReadonlyArray<DynoState | string>
}

/**
 * Poll `dyno.info` until the dyno exists and (optionally) reaches a
 * caller-specified state. Absorbs two distinct races:
 *
 *   - **Post-creation 404.** The platform briefly returns 404 for a
 *     newly-provisioning dyno even after `dyno.create` resolves
 *     (also observable from log events emitting "Starting process"
 *     before the dyno row is queryable). Callers that just need the
 *     row to exist should omit `states` and accept the first 2xx —
 *     the dyno's `state` value does not gate the return.
 *   - **Wait for runnable.** Callers that need to act on the dyno
 *     (open an SSH connection, exec a one-off command) need it in
 *     `starting` or `up` first. Pass `{states: ['starting', 'up']}`
 *     and the helper polls until the dyno reports one of those
 *     states.
 *
 * Retry policy: 404, 429, and 503 are treated as transient and
 * trigger another attempt. 429 responses honor `Retry-After` for
 * the next wait. Any other error throws immediately.
 *
 * After {@link WaitForInfoOptions.attempts} attempts:
 *   - If state-filtered, throws {@link DynoNotReadyError} carrying
 *     the last observed dyno.
 *   - Otherwise rethrows the last transient error.
 *
 * @example
 * ```ts
 * // Race past the post-creation 404; return on first 2xx regardless of state.
 * await platform.dyno.waitForInfo(app, name)
 *
 * // Wait for the dyno to be ready to accept connections.
 * await platform.dyno.waitForInfo(app, name, {states: ['starting', 'up']})
 * ```
 */
export async function waitForInfo(
  ctx: Pick<ResourceCtx, 'platform'>,
  appIdentity: string,
  dynoIdentity: string,
  options: WaitForInfoOptions = {},
): Promise<Dyno> {
  const {
    attempts = DEFAULT_ATTEMPTS,
    delayMs = DEFAULT_DELAY_MS,
    onPoll,
    signal,
    states,
  } = options

  signal?.throwIfAborted()

  // Scope the in-flight info call to the caller's signal so an abort
  // takes effect during the API call, not just during the backoff.
  const platform = signal ? ctx.platform.withOptions({signal}) : ctx.platform

  let lastError: Error | undefined
  let lastDyno: Dyno | undefined

  for (let attempt = 0; attempt < attempts; attempt++) {
    let nextDelayMs = delayMs

    try {
      const dyno = await platform.dyno.info(appIdentity, dynoIdentity)
      onPoll?.(dyno)
      if (!states || states.includes(dyno.state)) {
        return dyno
      }

      lastDyno = dyno
    } catch (error) {
      if (!isTransient(error)) throw error
      lastError = error as Error
      if (error instanceof RateLimitError && typeof error.retryAfter === 'number') {
        nextDelayMs = Math.max(delayMs, error.retryAfter * 1000)
      }
    }

    if (attempt < attempts - 1) {
      await wait(nextDelayMs, signal)
    }
  }

  if (states && lastDyno) {
    throw new DynoNotReadyError(lastDyno, states, attempts)
  }

  throw lastError ?? new Error(`Dyno '${dynoIdentity}' on app '${appIdentity}' was not available within ${attempts} attempts.`)
}

/**
 * Errors the platform commonly returns transiently during a dyno's
 * provisioning window. Anything else propagates so callers see real
 * failures (auth, app-not-found-permanently, 5xx that aren't 503).
 */
function isTransient(error: unknown): boolean {
  if (error instanceof NotFoundError) return true
  if (error instanceof RateLimitError) return true
  if (error instanceof HerokuApiError && error.statusCode === 503) return true
  return false
}
