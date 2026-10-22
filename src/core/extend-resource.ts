import type {HerokuApiClientOptions} from '@heroku/heroku-fetch'

import {HerokuApiClient} from '@heroku/heroku-fetch'

import type {DashboardBackendClient} from '../services/dashboard-backend.js'
import type {DataClient} from '../services/data.js'
import type {MetricsClient} from '../services/metrics.js'
import type {NotificationsClient} from '../services/notifications.js'
import type {PlatformClient} from '../services/platform.js'
import type {RepositoriesApiClient} from '../services/repositories-api.js'
import type {RepositoriesClient} from '../services/repositories.js'

export type ServiceName = 'dashboardBackend' | 'data' | 'metrics' | 'notifications' | 'platform' | 'repositories' | 'repositoriesApi'

type BaseResourceCtx = {
  dashboardBackend: DashboardBackendClient
  data: DataClient
  metrics: MetricsClient
  notifications: NotificationsClient
  platform: PlatformClient
  repositories: RepositoriesClient
}

export type ResourceCtx = {
  /**
   * Build a raw {@link HerokuApiClient} that inherits the SDK's resolved
   * client options for the `inheritFrom` service bundle (token,
   * `userAgent`/headers, `signal`, `timeout`, `warn`, …), with `overrides`
   * applied last.
   *
   * `inheritFrom` selects *which resolved option bundle to start from* — not
   * the wire service; pass `service` in `overrides` to redirect the client to
   * a different host and auth behavior. The returned client is raw, NOT the
   * managed service client: it does not carry that client's `defaultAccept`
   * (e.g. the platform's `version=3.sdk`) or routes proxy, so callers issue
   * `get`/`post`/`stream` directly and set `Accept` per call.
   *
   * When `overrides.service === 'custom'` the inherited bundle is narrowed to
   * identity and cancellation only (never auth/routing), so a custom stream
   * host can't receive the Heroku token, a `reauthorize` login callback, or
   * consumer headers. Prefer {@link makeCustomHostClient} for that case rather
   * than assembling the overrides by hand.
   *
   * Optional for compatibility with existing extension contexts; prefer
   * {@link makeCtxClient} at call sites so a context predating this stays
   * on the pre-threading behavior.
   *
   * TODO(next major): make this required on ResourceCtx and drop the
   * {@link makeCtxClient} fallback once external hand-built contexts are no
   * longer supported.
   */
  makeClient?: (inheritFrom: ServiceName, overrides?: HerokuApiClientOptions) => HerokuApiClient
  /** Available to SDK-provided extensions; optional for compatibility with existing extension contexts. */
  repositoriesApi?: RepositoriesApiClient
} & BaseResourceCtx

/**
 * Build a raw {@link HerokuApiClient} from a resource context, inheriting the
 * SDK's resolved client options for the `inheritFrom` service bundle
 * (identity, `signal`, `warn`, token, …) with `overrides` applied last. Falls
 * back to a bare client carrying only `overrides` when the context predates
 * {@link ResourceCtx.makeClient} (e.g. a hand-built test ctx, or a standalone
 * call with no SDK behind it), preserving the pre-threading behavior exactly.
 */
export function makeCtxClient(
  ctx: Pick<ResourceCtx, 'makeClient'>,
  inheritFrom: ServiceName,
  overrides: HerokuApiClientOptions = {},
): HerokuApiClient {
  return ctx.makeClient ? ctx.makeClient(inheritFrom, overrides) : new HerokuApiClient(overrides)
}

/**
 * Build a raw {@link HerokuApiClient} for a non-Heroku-credential host — a
 * custom stream/API host the routes-generated clients don't cover (logplex,
 * busl, exec-manager). Inherits only the SDK's identity and cancellation from
 * the platform option bundle; forces `service: 'custom'`, the given `baseUrl`,
 * and an empty `token`, and drops every auth/routing option (`reauthorize`,
 * `headers`, `hooks`, `twoFactor`, `region`, …) so none crosses to the
 * third-party origin. `overrides` the call site explicitly sets still apply —
 * use them for a per-host header or timeout, not to smuggle inherited auth.
 */
export function makeCustomHostClient(
  ctx: Pick<ResourceCtx, 'makeClient'>,
  baseUrl: string,
  overrides: Omit<HerokuApiClientOptions, 'baseUrl' | 'service' | 'token'> = {},
): HerokuApiClient {
  return makeCtxClient(ctx, 'platform', {
    ...overrides, baseUrl, service: 'custom', token: '',
  })
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ResourceMethods = Record<string, (...args: any[]) => any>

export type ResourceExtension<
  S extends ServiceName = ServiceName,
  R extends string = string,
  M extends ResourceMethods = ResourceMethods,
> = {
  factory: (ctx: ResourceCtx) => M
  resource: R
  service: S
}

export function extendResource<
  S extends ServiceName,
  R extends string,
  M extends ResourceMethods,
>(
  service: S,
  resource: R,
  factory: (ctx: ResourceCtx) => M,
): ResourceExtension<S, R, M> {
  return {factory, resource, service}
}

// --- Type utilities used by HerokuSDK to project extensions onto service types ---

export type UnionToIntersection<U>
  = (U extends unknown ? (k: U) => void : never) extends (k: infer I) => void ? I : never

export type ExtensionsFor<
  Exts extends readonly ResourceExtension[],
  S extends ServiceName,
> = Extract<Exts[number], ResourceExtension<S, string, ResourceMethods>>

export type MethodsForResource<E, R extends string>
  = UnionToIntersection<E extends ResourceExtension<ServiceName, R, infer M> ? M : never>

type ResourceKeysOf<E> = E extends ResourceExtension<ServiceName, infer R, ResourceMethods> ? R : never

export type ApplyExtensions<Base, E>
  = & {
    [K in keyof Base]: K extends ResourceKeysOf<E>
      ? MethodsForResource<E, K & string> & Omit<Base[K], keyof MethodsForResource<E, K & string>>
      : Base[K]
  }
  & {
    [K in ResourceKeysOf<E> as K extends keyof Base ? never : K]:
    MethodsForResource<E, K & string>
  }
