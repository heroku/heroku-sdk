/* eslint-disable camelcase -- request body fields follow the platform's snake_case wire format */
import type {HerokuApiClientOptions} from '@heroku/heroku-fetch'
import type {Dyno, DynoCreateOpts} from '@heroku/types/3.sdk'

import {HerokuApiClient, HerokuApiError} from '@heroku/heroku-fetch'

import type {ResourceCtx} from '../../../core/extend-resource.js'

const DEFAULT_RUN_RETRIES = 2

const ACCEPT_RUN_INSIDE = 'application/vnd.heroku+json; version=3.sdk'

export type RunDynoOptions = {
  /**
   * When `true`, the platform returns a dyno with a non-null
   * `attach_url` the caller can use to open its own interactive
   * session (STDIN/STDOUT rendezvous). The SDK itself does not open
   * the connection.
   */
  attach?: boolean
  /**
   * Options forwarded to the raw `HerokuApiClient` created for the
   * exec-inside path (`dyno` is set). The route registry has no entry
   * for `POST /apps/{app}/dynos/{dyno}`, so that call is issued via a
   * bare client. Ignored when `dyno` is omitted — the standard
   * create-one-off path uses the SDK's own routes client.
   */
  clientOptions?: HerokuApiClientOptions
  /**
   * If set, exec `command` inside the named dyno via
   * `POST /apps/{app}/dynos/{dyno}` with the `version=3.run-inside`
   * Accept variant. Omit to create a new one-off dyno via
   * `POST /apps/{app}/dynos`.
   */
  dyno?: string
  /** Additional environment variables layered onto the dyno. */
  env?: Record<string, string>
  /**
   * When `true`, the command is wrapped so its exit status is echoed
   * to stdout on completion — a `￿ heroku-command-exit-status:
   * <n>` line consumers may parse to surface the process exit code
   * over the attach stream.
   */
  exitCode?: boolean
  /**
   * Serialized to the platform as `force_no_tty`. Forces an attached
   * one-off dyno to not run in a TTY even when the caller's
   * environment looks like one.
   */
  forceNoTTY?: boolean
  signal?: AbortSignal
  size?: string
  type?: string
}

/**
 * Create a one-off dyno or exec a command inside an existing one.
 *
 * Route selection:
 *   - `POST /apps/{app}/dynos` (default) creates a new one-off dyno.
 *     Uses the SDK's routes client, which sends the platform
 *     service's default `Accept: version=3` header.
 *   - `POST /apps/{app}/dynos/{dyno}` (when `options.dyno` is set)
 *     execs the command inside the named dyno. Uses a raw
 *     `HerokuApiClient` with `Accept: version=3.sdk` because the
 *     routes registry has no entry for this endpoint.
 *
 * Retries: the runtime API occasionally returns 409 while a newly
 * pushed app's release is still propagating. This is transient and
 * short-lived, so 409 is retried up to two times back-to-back with no
 * delay. Any other error propagates. Matches the retry semantics of
 * the historical CLI implementation.
 *
 * The returned `Dyno` includes `attach_url` for callers who want to
 * open their own interactive session; the SDK does not establish the
 * session, spawn ssh, or manage TTY state.
 */
export async function runDyno(
  ctx: Pick<ResourceCtx, 'platform'>,
  appIdentity: string,
  command: string,
  options: RunDynoOptions = {},
): Promise<Dyno> {
  options.signal?.throwIfAborted()

  const body: DynoCreateOpts = {
    command: options.exitCode
      ? `${command}; echo "￿ heroku-command-exit-status: $?"`
      : command,
  }
  if (options.attach !== undefined) body.attach = options.attach
  if (options.env) body.env = options.env
  if (options.forceNoTTY !== undefined) body.force_no_tty = options.forceNoTTY
  if (options.size !== undefined) body.size = options.size
  if (options.type !== undefined) body.type = options.type

  /* eslint-disable no-await-in-loop -- retry is inherently sequential on 409 */
  let attemptsLeft = DEFAULT_RUN_RETRIES + 1
  while (true) {
    attemptsLeft--
    try {
      return await postRun(ctx, appIdentity, body, options)
    } catch (error) {
      if (attemptsLeft > 0 && error instanceof HerokuApiError && error.statusCode === 409) {
        continue
      }

      throw error
    }
  }
  /* eslint-enable no-await-in-loop */
}

async function postRun(
  ctx: Pick<ResourceCtx, 'platform'>,
  appIdentity: string,
  body: DynoCreateOpts,
  options: RunDynoOptions,
): Promise<Dyno> {
  if (options.dyno) {
    const apiClient = new HerokuApiClient({
      ...options.clientOptions,
      service: 'platform',
    })
    const path = `/apps/${encodeURIComponent(appIdentity)}/dynos/${encodeURIComponent(options.dyno)}`
    const response = await apiClient.post(path, body, {
      headers: {Accept: ACCEPT_RUN_INSIDE},
      signal: options.signal,
    })
    return (await response.json()) as Dyno
  }

  const platform = options.signal ? ctx.platform.withOptions({signal: options.signal}) : ctx.platform
  return platform.dyno.create(appIdentity, body)
}
