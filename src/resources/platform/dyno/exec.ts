/* eslint-disable camelcase -- exec-manager wire fields follow the platform's snake_case format */
import type {HerokuApiClientOptions} from '@heroku/heroku-fetch'
import type {
  App, BuildpackInstallation, ConfigVar, Dyno,
} from '@heroku/types/3.sdk'

import {HerokuApiClient, NotFoundError} from '@heroku/heroku-fetch'

import type {ResourceCtx} from '../../../core/extend-resource.js'

import {wait} from '../../../utils/wait.js'
import {waitForInfo, type WaitForInfoOptions} from './wait-for-info.js'

/** The app feature that gates Heroku Exec. */
const EXEC_FEATURE = 'runtime-heroku-exec'

/** Default exec-manager host used when no override is configured. */
const DEFAULT_EXEC_HOST = 'https://exec-manager.heroku.com/'

/** Exec-manager API prefixes. v1 is the legacy add-on path; v2 is current. */
const EXEC_API_PATH_LEGACY = '/api/v1'
const EXEC_API_PATH_CURRENT = '/api/v2'

/** Milliseconds to let the feature-enable settle before restarting dynos. */
const DEFAULT_SETTLE_MS = 2000

export type ExecOptions = {
  signal?: AbortSignal
}

/**
 * Raw facts the CLI needs to decide whether — and how — Heroku Exec can
 * be enabled for an app. This helper only gathers; every branch
 * (Shield restriction, container-stack warning, missing-buildpack
 * error, the deprecated `HEROKU_EXEC_URL` add-on notice) stays in the
 * caller so the SDK owns no presentation or prompting.
 */
export type ExecPrereqs = {
  /** Installed buildpacks, for the exec-buildpack presence check. */
  buildpacks: BuildpackInstallation[]
  /** `build_stack.name`, e.g. `'container'`. */
  buildStack: string | undefined
  /** Full config-var map; the caller reads `HEROKU_EXEC_URL` off it. */
  configVars: ConfigVar
  /** Whether the `runtime-heroku-exec` feature is already enabled. */
  featureEnabled: boolean
  /** App generation; `'fir'` apps do not support exec. */
  generation: string
  /** App's Private Space, if any (carries `shield`). */
  space: App['space']
}

/**
 * Gather the app facts that gate Heroku Exec in one parallel round-trip:
 * app info, buildpack installations, config vars, and the exec feature.
 *
 * Returns raw facts only — the caller branches on them. `configVars` is
 * returned whole because the caller inspects `HEROKU_EXEC_URL` (the
 * deprecated add-on) as well as passing config through to the exchange.
 */
export async function execPrereqs(
  ctx: Pick<ResourceCtx, 'platform'>,
  appIdentity: string,
  options: ExecOptions = {},
): Promise<ExecPrereqs> {
  options.signal?.throwIfAborted()
  const platform = options.signal ? ctx.platform.withOptions({signal: options.signal}) : ctx.platform

  const [app, buildpacks, configVars, feature] = await Promise.all([
    platform.app.info(appIdentity),
    platform.buildpackInstallation.list(appIdentity),
    platform.configVar.infoForApp(appIdentity),
    // fir apps have no runtime-heroku-exec feature, so this 404s there. A
    // missing feature must not sink the whole gather — the caller reads
    // `generation` to reject fir. Only a 404 degrades to disabled; other
    // errors still propagate.
    platform.appFeature.info(appIdentity, EXEC_FEATURE).catch((error: unknown) => {
      if (error instanceof NotFoundError) return {enabled: false}
      throw error
    }),
  ])

  return {
    buildpacks,
    buildStack: app.build_stack?.name,
    configVars,
    featureEnabled: Boolean(feature.enabled),
    generation: app.generation,
    space: app.space,
  }
}

/**
 * Enable the `runtime-heroku-exec` feature on an app. Used both on the
 * first-run restart path and on the Private-Space buildpack path, so it
 * stays a bare enable — the caller decides whether a restart follows.
 */
export async function enableExec(
  ctx: Pick<ResourceCtx, 'platform'>,
  appIdentity: string,
  options: ExecOptions = {},
): Promise<void> {
  options.signal?.throwIfAborted()
  const platform = options.signal ? ctx.platform.withOptions({signal: options.signal}) : ctx.platform
  await platform.appFeature.update(appIdentity, EXEC_FEATURE, {enabled: true})
}

/**
 * Thrown by {@link restartForExec} the moment the awaited dyno reports
 * `crashed`, so the caller can surface the failure immediately rather
 * than waiting out the remaining poll attempts.
 */
export class DynoCrashedError extends Error {
  public readonly id = 'dyno_crashed'

  constructor(public readonly dyno: Dyno) {
    super(`Dyno '${dyno.name}' crashed while waiting for Heroku Exec to start.`)
    this.name = 'DynoCrashedError'
  }
}

export type RestartForExecOptions = WaitForInfoOptions & {
  /**
   * Milliseconds to wait after enabling the feature before restarting,
   * letting the enable propagate. Defaults to 2000, matching the
   * historical CLI behavior.
   */
  settleMs?: number
}

/**
 * Restart all of an app's dynos and wait for the named dyno to come
 * back `up`. Enabling Heroku Exec for the first time requires a dyno
 * restart, so this bundles the settle delay, `dyno.restartAll`, and the
 * wait-for-`up` poll into one step. A `crashed` dyno throws
 * {@link DynoCrashedError} at once instead of exhausting the attempts.
 *
 * The wait is bounded by {@link WaitForInfoOptions.attempts} (default
 * 20). Callers that need to tolerate a slow boot should raise it.
 */
export async function restartForExec(
  ctx: Pick<ResourceCtx, 'platform'>,
  appIdentity: string,
  dynoIdentity: string,
  options: RestartForExecOptions = {},
): Promise<Dyno> {
  const {settleMs = DEFAULT_SETTLE_MS, ...waitOptions} = options
  const {signal} = waitOptions

  signal?.throwIfAborted()
  const platform = signal ? ctx.platform.withOptions({signal}) : ctx.platform

  await wait(settleMs, signal)
  await platform.dyno.restartAll(appIdentity)

  return waitForInfo(ctx, appIdentity, dynoIdentity, {
    ...waitOptions,
    onPoll(dyno) {
      if (dyno.state === 'crashed') {
        throw new DynoCrashedError(dyno)
      }

      waitOptions.onPoll?.(dyno)
    },
    states: ['up'],
  })
}

/** Connection info the exec-manager returns for a client-key exchange. */
export type ExecCredentials = {
  client_user: string
  dyno_ip: string
  proxy_public_key: string
  tunnel_host: string
}

export type ExchangeExecCredentialsOptions = {
  /** API key used as the Basic-auth password (username is the app). */
  apiKey: string
  /**
   * Options forwarded to the raw `HerokuApiClient`. The exec-manager is
   * not in the routes registry, so the call is issued via a bare client
   * with `service: 'custom'`.
   */
  clientOptions?: Omit<HerokuApiClientOptions, 'baseUrl' | 'service' | 'token'>
  /**
   * App config vars. When `HEROKU_EXEC_URL` is present (the deprecated
   * add-on), its embedded credentials and the `/api/v1` prefix are used.
   */
  configVars?: ConfigVar
  /** Target dyno, e.g. `'web.1'`. */
  dyno: string
  /** Extra request headers (e.g. from `HEROKU_HEADERS`). */
  headers?: Record<string, string>
  /** OpenSSH-format public key generated by the caller. */
  publicKey: string
  signal?: AbortSignal
}

/**
 * Exchange a client public key for exec connection info.
 *
 * Issues `PUT {execHost}{apiPath}/{dyno}` with `{client_key}` and Basic
 * auth (`app:apiKey`, or the credentials embedded in `HEROKU_EXEC_URL`)
 * via a bare `HerokuApiClient` — the exec-manager is a custom host with
 * no routes entry and no bearer token (the empty `token` lets the Basic
 * `Authorization` header survive). The caller feeds the returned info,
 * plus the private key it holds, to its own SSH transport; the SDK does
 * not open the connection.
 */
export async function exchangeExecCredentials(
  appIdentity: string,
  options: ExchangeExecCredentialsOptions,
): Promise<ExecCredentials> {
  options.signal?.throwIfAborted()

  const endpoint = resolveExecEndpoint(appIdentity, options.apiKey, options.configVars)
  const client = newExecClient(endpoint.baseUrl, options.clientOptions)
  const path = `${endpoint.apiPath}/${encodeURIComponent(options.dyno)}`

  const response = await client.put(path, {client_key: options.publicKey}, {
    headers: {
      ...options.headers,
      Authorization: endpoint.authorization,
      'Content-Type': 'application/json',
    },
    signal: options.signal,
  })

  return parseExecBody<ExecCredentials>(response)
}

/** A running exec reservation, as reported by the exec-manager status endpoint. */
export type ExecReservation = {
  [key: string]: unknown
  dyno_name: string
}

export type ExecStatusOptions = {
  apiKey: string
  clientOptions?: Omit<HerokuApiClientOptions, 'baseUrl' | 'service' | 'token'>
  configVars?: ConfigVar
  headers?: Record<string, string>
  signal?: AbortSignal
}

/**
 * List the app's running exec reservations.
 *
 * Issues `GET {execHost}{apiPath}` (no dyno segment) with the same
 * custom-host Basic-auth setup as {@link exchangeExecCredentials}. The
 * caller correlates each reservation's `dyno_name` with live dyno state
 * for display.
 */
export async function execStatus(
  appIdentity: string,
  options: ExecStatusOptions,
): Promise<ExecReservation[]> {
  options.signal?.throwIfAborted()

  const endpoint = resolveExecEndpoint(appIdentity, options.apiKey, options.configVars)
  const client = newExecClient(endpoint.baseUrl, options.clientOptions)

  const response = await client.get(endpoint.apiPath, {
    headers: {...options.headers, Authorization: endpoint.authorization},
    signal: options.signal,
  })

  return parseExecBody<ExecReservation[]>(response)
}

type ExecEndpoint = {
  apiPath: string
  authorization: string
  baseUrl: string
}

/**
 * Resolve the exec-manager base URL, API prefix, and Basic-auth header.
 *
 * When `HEROKU_EXEC_URL` is set as a config var (the deprecated add-on),
 * that URL carries its own embedded credentials and uses the `/api/v1`
 * prefix. Otherwise the host comes from the `HEROKU_EXEC_URL`
 * environment override or the default exec-manager, authenticated as
 * `app:apiKey` against `/api/v2`.
 */
function resolveExecEndpoint(
  appIdentity: string,
  apiKey: string,
  configVars: ConfigVar | undefined,
): ExecEndpoint {
  const configUrl = configVars?.HEROKU_EXEC_URL
  if (configUrl) {
    const url = new URL(configUrl)
    // URL.username/password are percent-encoded; decode before Basic auth so
    // credentials with reserved characters (e.g. `p%40ss`) authenticate.
    return {
      apiPath: EXEC_API_PATH_LEGACY,
      authorization: toBasicAuth(decodeURIComponent(url.username), decodeURIComponent(url.password)),
      baseUrl: `${url.protocol}//${url.host}`,
    }
  }

  const url = new URL(process.env.HEROKU_EXEC_URL ?? DEFAULT_EXEC_HOST)
  return {
    apiPath: EXEC_API_PATH_CURRENT,
    authorization: toBasicAuth(appIdentity, apiKey),
    baseUrl: `${url.protocol}//${url.host}`,
  }
}

function newExecClient(
  baseUrl: string,
  clientOptions: Omit<HerokuApiClientOptions, 'baseUrl' | 'service' | 'token'> | undefined,
): HerokuApiClient {
  return new HerokuApiClient({
    ...clientOptions, baseUrl, service: 'custom', token: '',
  })
}

function toBasicAuth(username: string, password: string): string {
  return `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`
}

/**
 * Parse an exec-manager response body, tolerating either a JSON value or
 * a JSON string (double-encoded), so behavior matches the historical
 * raw `JSON.parse` regardless of the response `Content-Type`.
 */
async function parseExecBody<T>(response: Response): Promise<T> {
  const body = (await response.json()) as unknown
  return (typeof body === 'string' ? JSON.parse(body) : body) as T
}
