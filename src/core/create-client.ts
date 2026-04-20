import type { HerokuClient } from '@heroku/types'
import type { HerokuApiClientOptions } from '@heroku/api-client'
import { HerokuApiClient } from '@heroku/api-client'
import { routes } from '@heroku/types/routes'
import { dispatch } from './dispatcher.js'

export function createHerokuClient(options: HerokuApiClientOptions = {}): HerokuClient {
  const httpClient = new HerokuApiClient(options)

  return new Proxy({} as HerokuClient, {
    get(_target, resourceKey: string) {
      const resourceRoutes = routes[resourceKey]
      if (!resourceRoutes) return undefined

      return new Proxy({}, {
        get(_t, methodKey: string) {
          const route = resourceRoutes[methodKey]
          if (!route) return undefined
          return (...args: unknown[]) => dispatch(httpClient, route, args)
        },
      })
    },
  })
}
