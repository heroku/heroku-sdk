import type {HerokuApiClientOptions} from '@heroku/api-client'
// type-only; identical structure across all services
import type {RouteDefinition} from '@heroku/types/3.sdk/routes'

import {HerokuApiClient} from '@heroku/api-client'

import {dispatch} from './dispatcher.js'

type RoutesModule = Record<string, Record<string, RouteDefinition>>

export function createClient<T>(routes: RoutesModule, options: HerokuApiClientOptions = {}): T {
  const httpClient = new HerokuApiClient(options)

  return new Proxy({}, {
    get(_target, resourceKey: string) {
      if (!Object.hasOwn(routes, resourceKey)) return
      const resourceRoutes = routes[resourceKey]

      return new Proxy({}, {
        get(_t, methodKey: string) {
          const route = resourceRoutes[methodKey]
          if (!route) return
          return (...args: unknown[]) => dispatch(httpClient, route, args)
        },
      })
    },
  }) as T
}
