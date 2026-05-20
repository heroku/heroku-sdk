import createDebug from 'debug'

import type { ResourceCtx, ResourceExtension, ResourceMethods } from './extend-resource.js'

const debug = createDebug('heroku:sdk:extensions')

export function mergeExtensions<T extends object>(
  client: T,
  extensions: readonly ResourceExtension[],
  ctx: ResourceCtx,
): T {
  const methodsByResource = new Map<string, ResourceMethods>()

  for (const ext of extensions) {
    const merged = methodsByResource.get(ext.resource) ?? {}
    Object.assign(merged, ext.factory(ctx))
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
