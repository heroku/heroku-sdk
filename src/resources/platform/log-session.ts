import type {LogSession, LogSessionCreateOpts} from '@heroku/types/3.sdk'

import createDebug from 'debug'

import type {ResourceCtx} from '../../core/extend-resource.js'

import {extendResource} from '../../core/extend-resource.js'
import {getGeneration} from './app.js'

const debug = createDebug('heroku:sdk:resources:log-session')

const DEFAULT_FIR_SESSION_TIMEOUT_MS = 15 * 60 * 1000
const FIR_TIMEOUT_ERROR_MESSAGE = 'Fir log stream timeout'

export type StreamLogsOptions = {
  /** Limit output to a single dyno (e.g. `web.1` on Cedar, `web-abc-123` on Fir). */
  dyno?: string
  /**
   * Optional fetch override. Useful in Node for injecting User-Agent
   * or proxy support. Defaults to the global fetch.
   */
  fetch?: typeof fetch
  /**
   * Number of recent lines to fetch before tailing. Cedar-generation
   * apps only — silently ignored on Fir.
   */
  lines?: number
  /**
   * Fires once per session creation, before the SDK opens the
   * `logplex_url` stream. Receives the resolved generation so the
   * caller can surface generation-specific UX (e.g. "Fetching
   * logs..." for Fir, where provisioning the stream takes a moment).
   *
   * Fires on every recreate when tailing.
   */
  onSessionCreated?: (info: {generation: 'cedar' | 'fir' | undefined; isRecreate: boolean}) => Promise<void> | void
  /**
   * When `tail` is true, watch for the platform's idle timeout and
   * recreate the log session to keep streaming. Defaults to true.
   * Set to false if you want a single bounded stream and surface the
   * disconnect to the caller.
   */
  recreateSession?: boolean
  /**
   * If `recreateSession` is true, the SDK forces a recreate after
   * this many milliseconds without seeing data. Defaults to
   * 15 minutes (matches the Fir platform timeout).
   */
  sessionTimeoutMs?: number
  signal?: AbortSignal
  /** Limit output to a single source (e.g. `app`, `heroku`). */
  source?: string
  /**
   * If true, the platform keeps the stream open and pushes lines as
   * they arrive. The platform may close the connection on its own
   * cadence (Fir is documented to time out around 15 minutes); when
   * `recreateSession` is also true, the SDK transparently opens a
   * new session and continues yielding lines.
   *
   * Defaults to false. Note: Fir-generation apps always tail (the
   * platform doesn't support a bounded log session there), so the
   * SDK forces `tail: true` for Fir regardless of what the caller
   * asked for.
   */
  tail?: boolean
  /**
   * Limit output to a process type (e.g. `web`, `worker`). On Cedar
   * the underlying API combines `dyno` and `type` into a single
   * field; the SDK handles that translation for you.
   */
  type?: string
}

/**
 * Stream logs for an app, yielding one line at a time.
 *
 * Creates a log session via `logSession.create`, opens the resulting
 * `logplex_url`, and parses the chunked plain-text response into
 * newline-delimited entries. Use `tail: true` to keep the stream
 * open; `recreateSession: true` (the default when tailing) makes the
 * SDK transparently re-open a new session after the platform's idle
 * timeout, so the iterator keeps yielding without the caller having
 * to handle the reconnect.
 *
 * The iterator terminates cleanly when:
 *   - the platform closes a non-tailing stream (all lines yielded)
 *   - `signal` is aborted (an `AbortError` propagates)
 *   - `recreateSession` is false and the platform closes a tail
 *
 * The iterator throws on:
 *   - non-2xx response from the logplex URL
 *   - errors thrown by `logSession.create` (auth, app-not-found, etc.)
 */
export async function * streamLogs(
  ctx: Pick<ResourceCtx, 'platform'>,
  appIdentity: string,
  options: StreamLogsOptions = {},
): AsyncGenerator<string, void, unknown> {
  const {
    dyno,
    fetch: fetchFn = fetch,
    lines,
    sessionTimeoutMs = DEFAULT_FIR_SESSION_TIMEOUT_MS,
    signal,
    source,
    tail = false,
    type,
  } = options

  signal?.throwIfAborted()

  const generation = await getGeneration(ctx, appIdentity, {signal})
  const isFir = generation === 'fir'
  // Fir doesn't support a bounded session; the platform always streams.
  const effectiveTail = isFir ? true : tail
  const recreateSession = options.recreateSession ?? effectiveTail

  const createOpts = buildCreateOpts({
    dyno, isFir, lines, source, tail: effectiveTail, type,
  })

  // The recreate loop is inherently sequential: each session must
  // close before we ask for the next one.
  /* eslint-disable no-await-in-loop */
  let isRecreate = false
  while (true) {
    debug('streamLogs creating session app=%s generation=%s tail=%s', appIdentity, generation ?? '<unknown>', effectiveTail)
    const session: LogSession = await ctx.platform.logSession.create(appIdentity, createOpts)
    if (!session.logplex_url) {
      throw new Error('Log session response did not include a logplex_url.')
    }

    await options.onSessionCreated?.({generation, isRecreate})
    isRecreate = true

    debug('streamLogs session=%s opening stream', session.id)
    let timedOut = false
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined

    try {
      const response = await fetchFn(session.logplex_url, {signal})
      if (!response.ok) {
        throw new Error(`Logplex stream returned HTTP ${response.status}`)
      }

      if (!response.body) {
        throw new Error('Logplex stream returned no body.')
      }

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let pending = ''

      // Force a recreate after sessionTimeoutMs of silence; ignored
      // when not tailing.
      const armTimeout = () => {
        if (!recreateSession) return
        if (timeoutHandle) clearTimeout(timeoutHandle)
        timeoutHandle = setTimeout(() => {
          timedOut = true
          debug('streamLogs session=%s timed out after %dms', session.id, sessionTimeoutMs)
          reader.cancel().catch(() => {})
        }, sessionTimeoutMs)
      }

      armTimeout()

      try {
        while (true) {
          const {done, value} = await reader.read()
          if (done) break

          armTimeout()
          pending += decoder.decode(value, {stream: true})
          let newlineIndex = pending.indexOf('\n')
          while (newlineIndex !== -1) {
            const line = pending.slice(0, newlineIndex)
            pending = pending.slice(newlineIndex + 1)
            if (line.length > 0) yield line
            newlineIndex = pending.indexOf('\n')
          }
        }

        // Flush any trailing partial line that didn't end in '\n'.
        const trailing = pending + decoder.decode()
        if (trailing.length > 0) yield trailing
      } finally {
        if (timeoutHandle) clearTimeout(timeoutHandle)
        reader.releaseLock()
      }

      if (timedOut) {
        debug('streamLogs session=%s recreating after timeout', session.id)
        continue
      }

      if (!recreateSession) {
        return
      }

      debug('streamLogs session=%s remote closed; recreating', session.id)
    } catch (error) {
      if (timeoutHandle) clearTimeout(timeoutHandle)
      if (signal?.aborted) throw error
      if (timedOut) continue

      // Translate Fir's documented timeout error message into a recreate.
      if (error instanceof Error && error.message === FIR_TIMEOUT_ERROR_MESSAGE && recreateSession) {
        continue
      }

      throw error
    }
  }
  /* eslint-enable no-await-in-loop */
}

/**
 * Translate the SDK's consumer-facing options into the shape the
 * platform's `log-sessions` endpoint expects per generation:
 *   - Cedar's session takes a single `dyno` field that historically
 *     accepted either a process type or a specific dyno; we collapse
 *     `dyno || type` for the caller. `lines` and `tail` are honored.
 *   - Fir's session takes `dyno` and `type` separately and ignores
 *     `lines`; the stream always tails.
 */
function buildCreateOpts(options: {
  dyno?: string
  isFir: boolean
  lines?: number
  source?: string
  tail: boolean
  type?: string
}): LogSessionCreateOpts {
  const createOpts: LogSessionCreateOpts = {source: options.source}
  if (options.isFir) {
    if (options.dyno) createOpts.dyno = options.dyno
    if (options.type) createOpts.type = options.type
  } else {
    const cedarDyno = options.dyno ?? options.type
    if (cedarDyno) createOpts.dyno = cedarDyno
    if (options.lines !== undefined) createOpts.lines = options.lines
    createOpts.tail = options.tail
  }

  return createOpts
}

export const logSessionExtensions = extendResource('platform', 'logSession', ctx => ({
  streamLogs: (appIdentity: string, options?: StreamLogsOptions) =>
    streamLogs(ctx, appIdentity, options),
}))
