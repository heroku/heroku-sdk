import type {HerokuApiClientOptions, RequestOptions} from '@heroku/heroku-fetch'
import type {RouteDefinition} from '@heroku/types/types'

import {HerokuApiClient} from '@heroku/heroku-fetch'
import createDebug from 'debug'

import {dispatch} from './dispatcher.js'

const debug = createDebug('heroku:sdk:client')

type RoutesModule = Record<string, Record<string, RouteDefinition>>

type SearchParams = NonNullable<RequestOptions['searchParams']>

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
  /**
   * Returns a same-shaped client where each route call applies the
   * provided URL search params. Subsequent `withSearchParams` calls
   * layer on top (later keys win).
   *
   * The original client is not mutated. Use this for endpoints that
   * accept platform filters like `eq[name]=foo` without baking the
   * params into the route registry.
   */
  withSearchParams(searchParams: SearchParams): RoutesClientExtras<T> & T
}

type ProxyContext = {
  inheritedHeaders?: Record<string, string>
  inheritedSearchParams?: SearchParams
}

export function createClient<T>(routes: RoutesModule, options: HerokuApiClientOptions = {}): RoutesClientExtras<T> & T {
  const httpClient = new HerokuApiClient(options)
  return buildClientProxy<T>(httpClient, routes, {})
}

function buildClientProxy<T>(
  httpClient: HerokuApiClient,
  routes: RoutesModule,
  ctx: ProxyContext,
): RoutesClientExtras<T> & T {
  return new Proxy({}, {
    get(_target, resourceKey: string) {
      if (resourceKey === 'withHeaders') {
        return (headers: Record<string, string>) => buildClientProxy<T>(
          httpClient,
          routes,
          {...ctx, inheritedHeaders: {...ctx.inheritedHeaders, ...headers}},
        )
      }

      if (resourceKey === 'withSearchParams') {
        return (searchParams: SearchParams) => buildClientProxy<T>(
          httpClient,
          routes,
          {...ctx, inheritedSearchParams: {...ctx.inheritedSearchParams, ...searchParams}},
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
            const requestOptions = buildRequestOptions(ctx)
            return dispatch(httpClient, route, args, `${resourceKey}.${methodKey}`, requestOptions)
          }
        },
      })
    },
  }) as RoutesClientExtras<T> & T
}

function buildRequestOptions(ctx: ProxyContext): RequestOptions | undefined {
  const options: RequestOptions = {}
  if (ctx.inheritedHeaders) options.headers = ctx.inheritedHeaders
  if (ctx.inheritedSearchParams) options.searchParams = ctx.inheritedSearchParams
  return Object.keys(options).length > 0 ? options : undefined
}
