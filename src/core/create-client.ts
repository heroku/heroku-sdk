import type {HerokuApiClientOptions} from '@heroku/api-client'
import type {HerokuClient} from '@heroku/types/3.sdk'

import {HerokuApiClient} from '@heroku/api-client'
import * as routes from '@heroku/types/3.sdk/routes'

import {dispatch} from './dispatcher.js'

export function createHerokuClient(options: HerokuApiClientOptions = {}): HerokuClient {
  const httpClient = new HerokuApiClient(options)

  return new Proxy({} as HerokuClient, {
    get(_target, resourceKey: string) {
      if (!Object.hasOwn(routes, resourceKey)) return
      const resourceRoutes = (routes as Record<string, Record<string, routes.RouteDefinition>>)[resourceKey]

      return new Proxy({}, {
        get(_t, methodKey: string) {
          const route = resourceRoutes[methodKey]
          if (!route) return
          return (...args: unknown[]) => dispatch(httpClient, route, args)
        },
      })
    },
  })
}
