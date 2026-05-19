import type {DataClient} from '../services/data.js'
import type {PlatformClient} from '../services/platform.js'

export type ServiceName = 'platform' | 'data'

export type ResourceCtx = {
  platform: PlatformClient
  data: DataClient
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ResourceMethods = Record<string, (...args: any[]) => any>

export type ResourceExtension<
  S extends ServiceName = ServiceName,
  R extends string = string,
  M extends ResourceMethods = ResourceMethods,
> = {
  service: S
  resource: R
  factory: (ctx: ResourceCtx) => M
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
  return {service, resource, factory}
}

// --- Type utilities used by HerokuSDK to project extensions onto service types ---

export type UnionToIntersection<U> =
  (U extends unknown ? (k: U) => void : never) extends (k: infer I) => void ? I : never

export type ExtensionsFor<
  Exts extends readonly ResourceExtension[],
  S extends ServiceName,
> = Extract<Exts[number], ResourceExtension<S, string, ResourceMethods>>

export type MethodsForResource<E, R extends string> =
  UnionToIntersection<E extends ResourceExtension<ServiceName, R, infer M> ? M : never>

type ResourceKeysOf<E> = E extends ResourceExtension<ServiceName, infer R, ResourceMethods> ? R : never

export type ApplyExtensions<Base, E> =
  & {
    [K in keyof Base]: K extends ResourceKeysOf<E>
      ? Base[K] & MethodsForResource<E, K & string>
      : Base[K]
  }
  & {
    [K in ResourceKeysOf<E> as K extends keyof Base ? never : K]:
      MethodsForResource<E, K & string>
  }
