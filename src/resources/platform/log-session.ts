import type {LogSession, LogSessionCreateOpts} from '@heroku/types/3.sdk'

import createDebug from 'debug'

import type {ResourceCtx} from '../../core/extend-resource.js'

import {extendResource} from '../../core/extend-resource.js'

const debug = createDebug('heroku:sdk:resources:log-session')

const DEFAULT_FIR_SESSION_TIMEOUT_MS = 15 * 60 * 1000
const FIR_TIMEOUT_ERROR_MESSAGE = 'Fir log stream timeout'

export type StreamLogsOptions = LogSessionCreateOpts & {
  /**
   * Optional fetch override. Useful in Node for injecting User-Agent
   * or proxy support. Defaults to the global fetch.
   */
  fetch?: typeof fetch
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
  /**
   * If true, the platform keeps the stream open and pushes lines as
   * they arrive. The platform may close the connection on its own
   * cadence (Fir is documented to time out around 15 minutes); when
   * `recreateSession` is also true, the SDK transparently opens a
   * new session and continues yielding lines.
   *
   * Defaults to false.
   */
  tail?: boolean
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
    fetch: fetchFn = fetch,
    recreateSession = options.tail ?? false,
    sessionTimeoutMs = DEFAULT_FIR_SESSION_TIMEOUT_MS,
    signal,
    ...createOpts
  } = options

  signal?.throwIfAborted()

  // The recreate loop is inherently sequential: each session must
  // close before we ask for the next one.
  /* eslint-disable no-await-in-loop */
  while (true) {
    debug('streamLogs creating session app=%s tail=%s', appIdentity, createOpts.tail ?? false)
    const session: LogSession = await ctx.platform.logSession.create(appIdentity, createOpts)
    if (!session.logplex_url) {
      throw new Error('Log session response did not include a logplex_url.')
    }

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

export const logSessionExtensions = extendResource('platform', 'logSession', ctx => ({
  streamLogs: (appIdentity: string, options?: StreamLogsOptions) =>
    streamLogs(ctx, appIdentity, options),
}))
