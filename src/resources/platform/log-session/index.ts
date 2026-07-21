import type {LogSession, LogSessionCreateOpts} from '@heroku/types/3.sdk'

import {HerokuApiClient} from '@heroku/heroku-fetch'
import createDebug from 'debug'

import type {ResourceCtx} from '../../../core/extend-resource.js'

import {extendResource} from '../../../core/extend-resource.js'
import {getGeneration} from '../app/index.js'
import {parseHerokuLogLine} from './parser.js'

export {
  type AttachmentAttachedEvent,
  type AttachmentDetachedEvent,
  type AttachmentUpdatedEvent,
  type HerokuLogEvent,
  parseHerokuLogLine,
  type ProvisioningCompletedEvent,
  type ScaledToEntry,
  type ScaledToEvent,
  type StartingProcessEvent,
  type StateChangedEvent,
} from './parser.js'

const debug = createDebug('heroku:sdk:resources:log-session')

const DEFAULT_FIR_SESSION_TIMEOUT_MS = 15 * 60 * 1000
// Maximum consecutive transport errors before we give up — protects
// against a persistently broken upstream (DNS, TLS, etc.) busy-looping
// forever. The counter resets on every successful yield.
const MAX_CONSECUTIVE_TRANSPORT_ERRORS = 5
// Initial backoff between recreate attempts; doubles up to a cap so
// a bad-network burst doesn't hammer the platform.
const TRANSPORT_RETRY_BASE_DELAY_MS = 500
const TRANSPORT_RETRY_MAX_DELAY_MS = 5000

export type StreamLogsOptions = {
  /** Limit output to a single dyno (e.g. `web.1` on Cedar, `web-abc-123` on Fir). */
  dyno?: string
  /**
   * Number of recent lines to fetch before tailing. Cedar-generation
   * apps only — silently ignored on Fir.
   */
  lines?: number
  /**
   * Maximum number of consecutive transport-error reconnects (TCP
   * reset, proxy `terminated`, EOF mid-stream, etc.) before the
   * iterator gives up and surfaces the error. Counter resets the
   * moment a real line yields again. Defaults to 5.
   */
  maxConsecutiveTransportErrors?: number
  /**
   * Cap on the per-attempt backoff after exponential growth.
   * Defaults to 5000ms.
   */
  maxRetryDelayMs?: number
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
   * Initial backoff between reconnect attempts after a transport
   * error; doubles each attempt up to {@link maxRetryDelayMs}.
   * Defaults to 500ms.
   */
  retryBaseDelayMs?: number
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
    lines,
    maxConsecutiveTransportErrors = MAX_CONSECUTIVE_TRANSPORT_ERRORS,
    maxRetryDelayMs = TRANSPORT_RETRY_MAX_DELAY_MS,
    retryBaseDelayMs = TRANSPORT_RETRY_BASE_DELAY_MS,
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
  let consecutiveTransportErrors = 0
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
      // Logplex URLs hit a region-specific stream host (e.g.
      // virginia.sessions.logs.heroku.com). The token is embedded in
      // the URL, so we use a custom-service client with no auth and
      // a per-call baseUrl; this also picks up heroku-fetch's
      // env-var proxy support.
      const parsed = new URL(session.logplex_url)
      const logplexClient = new HerokuApiClient({
        baseUrl: parsed.origin,
        service: 'custom',
        token: '',
      })
      // Fir's telemetry-proxy sends newline-delimited plain text by
      // default, but concatenates records with zero delimiter bytes —
      // splitting on '\n' yields nothing. Requesting SSE flips the
      // proxy into `text/event-stream`, where each record is framed
      // as `id: N\ndata: <line>\n\n` (Cedar's logplex ignores the
      // header and keeps sending `text/plain`).
      const response = await logplexClient.stream(`${parsed.pathname}${parsed.search}`, {
        headers: {Accept: 'text/event-stream'},
      })
      if (!response.body) {
        throw new Error('Logplex stream returned no body.')
      }

      const contentType = response.headers.get('content-type') ?? ''
      const isSse = contentType.toLowerCase().includes('text/event-stream')
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

          if (isSse) {
            // SSE events are separated by a blank line (`\n\n`). Each
            // event holds `data:` field lines whose values, joined by
            // `\n` per the spec, are the log line to yield.
            let boundary = pending.indexOf('\n\n')
            while (boundary !== -1) {
              const frame = pending.slice(0, boundary)
              pending = pending.slice(boundary + 2)
              // Any complete SSE frame — including heartbeats with no
              // data — is proof the transport is healthy, so reset the
              // retry counter here rather than only on yielded lines.
              consecutiveTransportErrors = 0
              const line = extractSseData(frame)
              if (line.length > 0) yield line

              boundary = pending.indexOf('\n\n')
            }
          } else {
            let newlineIndex = pending.indexOf('\n')
            while (newlineIndex !== -1) {
              const line = pending.slice(0, newlineIndex)
              pending = pending.slice(newlineIndex + 1)
              if (line.length > 0) {
                consecutiveTransportErrors = 0
                yield line
              }

              newlineIndex = pending.indexOf('\n')
            }
          }
        }

        // Flush any trailing partial line that didn't end in '\n'.
        // Only meaningful for the plain-text path — an SSE stream that
        // ends mid-frame has no complete event to yield.
        if (!isSse) {
          const trailing = pending + decoder.decode()
          if (trailing.length > 0) {
            consecutiveTransportErrors = 0
            yield trailing
          }
        }
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

      // When recreating, treat any transport-level failure (TCP
      // reset, proxy `terminated`, EOF mid-stream, the documented
      // Fir timeout, etc.) as recoverable: open a fresh session and
      // keep yielding. Without this the iterator dies on the first
      // network blip and tail consumers (e.g. the vscode resource
      // explorer) silently lose updates.
      //
      // To keep a permanently-broken upstream from busy-looping, cap
      // consecutive errors and back off between attempts. The counter
      // resets the moment we yield a real line again.
      if (recreateSession && consecutiveTransportErrors < maxConsecutiveTransportErrors) {
        consecutiveTransportErrors++
        const delay = Math.min(
          retryBaseDelayMs * (2 ** (consecutiveTransportErrors - 1)),
          maxRetryDelayMs,
        )
        debug(
          'streamLogs session=%s transport error (%d/%d); reconnecting after %dms: %s',
          session.id,
          consecutiveTransportErrors,
          maxConsecutiveTransportErrors,
          delay,
          (error as Error).message,
        )
        await waitOrAbort(delay, signal)
        continue
      }

      throw error
    }
  }
  /* eslint-enable no-await-in-loop */
}

/**
 * Extract the joined `data:` field values from a single SSE event
 * frame, per the HTML Living Standard's event-stream parsing rules.
 * Lines beginning with `:` are comments and skipped; other field
 * names (`id`, `event`, `retry`) are ignored — we only care about
 * the log payload. Multiple `data:` lines within one event are
 * joined with `\n`.
 */
function extractSseData(frame: string): string {
  const dataLines: string[] = []
  for (const rawLine of frame.split('\n')) {
    if (!rawLine || rawLine.startsWith(':')) continue
    const colon = rawLine.indexOf(':')
    const field = colon === -1 ? rawLine : rawLine.slice(0, colon)
    if (field !== 'data') continue
    // Per spec: strip a single leading space from the value.
    let value = colon === -1 ? '' : rawLine.slice(colon + 1)
    if (value.startsWith(' ')) value = value.slice(1)
    dataLines.push(value)
  }

  return dataLines.join('\n')
}

/**
 * Resolves after `ms` milliseconds, or rejects if the signal aborts
 * first. Used between recreate attempts so a persistent transport
 * failure doesn't busy-loop the platform's session-create endpoint.
 */
async function waitOrAbort(ms: number, signal?: AbortSignal): Promise<void> {
  if (!signal) {
    await new Promise<void>(resolve => {
      setTimeout(resolve, ms)
    })
    return
  }

  await new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason)
      return
    }

    const handle = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = (): void => {
      clearTimeout(handle)
      reject(signal.reason)
    }

    signal.addEventListener('abort', onAbort, {once: true})
  })
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
  parseHerokuLogLine,
  streamLogs: (appIdentity: string, options?: StreamLogsOptions) =>
    streamLogs(ctx, appIdentity, options),
}))
