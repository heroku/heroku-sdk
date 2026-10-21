import createDebug from 'debug'

import type {StickyRouteOptions} from './create-client.js'
import type {ResourceCtx, ResourceExtension, ResourceMethods} from './extend-resource.js'

const debug = createDebug('heroku:sdk:extensions')

/**
 * Re-derive the extension context so that an operation-wide cancellation set
 * via `sdk.platform.withOptions({signal})` also reaches the clients its
 * extensions issue requests through `ctx`.
 *
 * Extension factories close over `ctx.*` (e.g. `ctx.platform`) to issue their
 * own — often nested, sometimes cross-service — requests. Without this, a signal
 * set on a service client would reach generated route methods but never the
 * requests an extension method makes through `ctx`, so cancellation could not
 * stop the work an extension started. The derivation is applied to *every*
 * service client in `ctx` because cancellation is operation-wide and extensions
 * cross services (e.g. a `data` extension polls through `ctx.platform`).
 *
 * Only the operation-wide `signal` / `timeout` are propagated. A `withHeaders`
 * call, and the `headers` / `body` fields of a `withOptions` call, are
 * endpoint-specific and must not ride cross-service onto unrelated requests
 * (e.g. an `Accept-Expansion` header a sibling endpoint rejects), so they stay
 * on the routes client the caller scoped and are not re-derived here.
 *
 * `withOptions` returns a fresh client without mutating the original, and the
 * derived clients are memoized per key, so sibling derived clients — and the
 * base client — stay isolated from one another.
 */
function deriveCtx(ctx: ResourceCtx, method: 'withHeaders' | 'withOptions', args: unknown[]): ResourceCtx {
  if (method !== 'withOptions') return ctx

  const options = args[0] as StickyRouteOptions | undefined
  const scoped: StickyRouteOptions = {}
  if (options?.signal !== undefined) scoped.signal = options.signal
  if (options?.timeout !== undefined) scoped.timeout = options.timeout
  if (Object.keys(scoped).length === 0) return ctx

  const cache = new Map<keyof ResourceCtx, unknown>()
  const derived = {} as ResourceCtx

  for (const key of Object.keys(ctx) as Array<keyof ResourceCtx>) {
    Object.defineProperty(derived, key, {
      enumerable: true,
      get() {
        if (!cache.has(key)) {
          const client = ctx[key] as undefined | {withOptions?: (opts: StickyRouteOptions) => unknown}
          cache.set(key, typeof client?.withOptions === 'function' ? client.withOptions(scoped) : client)
        }

        return cache.get(key)
      },
    })
  }

  return derived
}

export function mergeExtensions<T extends object>(
  client: T,
  extensions: readonly ResourceExtension[],
  ctx: ResourceCtx,
): T {
  const methodsByResource = new Map<string, ResourceMethods>()

  for (const ext of extensions) {
    const factoryMethods = ext.factory(ctx)
    debug('loaded extension service=%s resource=%s methods=%o', ext.service, ext.resource, Object.keys(factoryMethods))
    const merged = methodsByResource.get(ext.resource) ?? {}
    Object.assign(merged, factoryMethods)
    methodsByResource.set(ext.resource, merged)
  }

  for (const [resource, methods] of methodsByResource) {
    const routeResource = (client as Record<string, unknown>)[resource]
    if (routeResource && typeof routeResource === 'object') {
      for (const methodName of Object.keys(methods)) {
        if (methodName in routeResource) {
          debug('extension shadows upstream route: %s.%s', resource, methodName)
        }
      }
    }
  }

  return new Proxy(client, {
    get(target, resourceKey: string, receiver) {
      // `withOptions` / `withHeaders` on the routes client return a
      // fresh routes proxy without our extensions layer. Intercept
      // them so the result is re-wrapped with the same extensions —
      // otherwise extension methods (like `addOn.listPlans`) silently
      // disappear after a `sdk.platform.withOptions({signal}).addOn`
      // chain.
      if (resourceKey === 'withOptions' || resourceKey === 'withHeaders') {
        const inner = Reflect.get(target, resourceKey, receiver)
        if (typeof inner !== 'function') {
          return inner
        }

        return (...args: unknown[]) => {
          const rewrapped = (inner as (...a: unknown[]) => T).apply(target, args)
          return mergeExtensions(rewrapped, extensions, deriveCtx(ctx, resourceKey, args))
        }
      }

      const extMethods = methodsByResource.get(resourceKey)
      const routeResource = Reflect.get(target, resourceKey, receiver)

      if (!extMethods) {
        return routeResource
      }

      const innerTarget: object = routeResource && typeof routeResource === 'object' ? routeResource : {}
      return new Proxy(innerTarget, {
        get(routeTarget, methodKey: string, methodReceiver) {
          if (Object.hasOwn(extMethods, methodKey)) {
            return extMethods[methodKey]
          }

          return Reflect.get(routeTarget, methodKey, methodReceiver)
        },
      })
    },
  })
}
