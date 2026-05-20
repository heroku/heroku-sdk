import type {HerokuApiClientOptions} from '@heroku/heroku-fetch'
// type-only; identical structure across all services
import type {RouteDefinition} from '@heroku/types/3.sdk/routes'

import {HerokuApiClient} from '@heroku/heroku-fetch'
import createDebug from 'debug'

import {dispatch} from './dispatcher.js'

const debug = createDebug('heroku:sdk:client')

type RoutesModule = Record<string, Record<string, RouteDefinition>>

export function createClient<T>(routes: RoutesModule, options: HerokuApiClientOptions = {}): T {
  const httpClient = new HerokuApiClient(options)

  return new Proxy({}, {
    get(_target, resourceKey: string) {
      if (!Object.hasOwn(routes, resourceKey)) {
        debug('unknown resource: %s', resourceKey)
        return
      }

      const resourceRoutes = routes[resourceKey]

      return new Proxy({}, {
        get(_t, methodKey: string) {
          const route = resourceRoutes[methodKey]
          if (!route) {
            debug('unknown method: %s.%s', resourceKey, methodKey)
            return
          }

          return (...args: unknown[]) => dispatch(httpClient, route, args, `${resourceKey}.${methodKey}`)
        },
      })
    },
  }) as T
}
