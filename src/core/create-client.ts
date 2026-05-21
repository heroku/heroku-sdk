import type {HerokuApiClientOptions, RequestOptions} from '@heroku/heroku-fetch'
import type {RouteDefinition} from '@heroku/types/types'

import {HerokuApiClient} from '@heroku/heroku-fetch'
import createDebug from 'debug'

import {dispatch} from './dispatcher.js'

const debug = createDebug('heroku:sdk:client')

type RoutesModule = Record<string, Record<string, RouteDefinition>>

/**
 * Methods available on every routes-generated client in addition to
 * the resources/methods generated from the routes registry.
 */
export type RoutesClientExtras<T> = {
  /**
   * Returns a same-shaped client where each route call applies the
   * provided headers. Caller-supplied headers override the api-client's
   * defaults; subsequent `withHeaders` calls layer on top.
   *
   * The original client is not mutated. Use this when a single
   * resource/method needs an Accept variant (e.g. `version=3.sdk`)
   * different from what the rest of the client uses.
   */
  withHeaders(headers: Record<string, string>): RoutesClientExtras<T> & T
}

export function createClient<T>(routes: RoutesModule, options: HerokuApiClientOptions = {}): RoutesClientExtras<T> & T {
  const httpClient = new HerokuApiClient(options)
  return buildClientProxy<T>(httpClient, routes)
}

function buildClientProxy<T>(
  httpClient: HerokuApiClient,
  routes: RoutesModule,
  inheritedHeaders?: Record<string, string>,
): RoutesClientExtras<T> & T {
  return new Proxy({}, {
    get(_target, resourceKey: string) {
      if (resourceKey === 'withHeaders') {
        return (headers: Record<string, string>) => buildClientProxy<T>(
          httpClient,
          routes,
          {...inheritedHeaders, ...headers},
        )
      }

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

          return (...args: unknown[]) => {
            const requestOptions: RequestOptions | undefined = inheritedHeaders
              ? {headers: inheritedHeaders}
              : undefined
            return dispatch(httpClient, route, args, `${resourceKey}.${methodKey}`, requestOptions)
          }
        },
      })
    },
  }) as RoutesClientExtras<T> & T
}
