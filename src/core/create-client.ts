import type {HerokuApiClientOptions} from '@heroku/api-client'
import type {HerokuClient} from '@heroku/types/3.sdk'
// type-only; identical structure across all services
import type {RouteDefinition} from '@heroku/types/3.sdk/routes'

import {HerokuApiClient} from '@heroku/api-client'
import * as routes from '@heroku/types/3.sdk/routes'

import {dispatch} from './dispatcher.js'

type RoutesModule = Record<string, Record<string, RouteDefinition>>

export function createClient<T>(routesModule: RoutesModule, options: HerokuApiClientOptions = {}): T {
  const httpClient = new HerokuApiClient(options)

  return new Proxy({}, {
    get(_target, resourceKey: string) {
      if (!Object.hasOwn(routesModule, resourceKey)) return
      const resourceRoutes = routesModule[resourceKey]

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

export function createHerokuClient(options: HerokuApiClientOptions = {}): HerokuClient {
  return createClient<HerokuClient>(routes, options)
}
