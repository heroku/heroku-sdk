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
   * client options for `service` (token, `userAgent`/headers, `signal`,
   * `timeout`, `warn`, …), with `overrides` applied last.
   *
   * For resource code that must talk to a host the routes-generated service
   * clients don't cover — a custom stream host (logplex, busl, exec-manager)
   * or a query variant the registry lacks — while still carrying the SDK's
   * identity and cancellation signal. The returned client is raw (not the
   * routes proxy), so callers use `get`/`post`/`stream` directly.
   *
   * Optional for compatibility with existing extension contexts; prefer
   * {@link makeCtxClient} at call sites so a context predating this stays
   * on the pre-threading behavior.
   */
  makeClient?: (service: ServiceName, overrides?: HerokuApiClientOptions) => HerokuApiClient
  /** Available to SDK-provided extensions; optional for compatibility with existing extension contexts. */
  repositoriesApi?: RepositoriesApiClient
} & BaseResourceCtx

/**
 * Build a raw {@link HerokuApiClient} from a resource context, inheriting the
 * SDK's resolved client options for `service` (identity, `signal`, `warn`,
 * token, …) with `overrides` applied last. Falls back to a bare client
 * carrying only `overrides` when the context predates {@link ResourceCtx.makeClient}
 * (e.g. a hand-built test ctx, or a standalone call with no SDK behind it),
 * preserving the pre-threading behavior exactly.
 */
export function makeCtxClient(
  ctx: Pick<ResourceCtx, 'makeClient'>,
  service: ServiceName,
  overrides: HerokuApiClientOptions = {},
): HerokuApiClient {
  return ctx.makeClient ? ctx.makeClient(service, overrides) : new HerokuApiClient(overrides)
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
