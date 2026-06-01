import createDebug from 'debug'

import type {ResourceCtx, ResourceExtension, ResourceMethods} from './extend-resource.js'

const debug = createDebug('heroku:sdk:extensions')

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
          return mergeExtensions(rewrapped, extensions, ctx)
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
