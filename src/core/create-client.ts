import type {HerokuApiClientOptions, RequestOptions} from '@heroku/heroku-fetch'
import type {RouteDefinition} from '@heroku/types/types'

import {HerokuApiClient} from '@heroku/heroku-fetch'
import createDebug from 'debug'

import {dispatch} from './dispatcher.js'

const debug = createDebug('heroku:sdk:client')

type RoutesModule = Record<string, Record<string, RouteDefinition>>

/**
 * Subset of `RequestOptions` that makes sense to apply across every
 * call on a derived client. Per-call concerns like `searchParams`
 * and `stream` are deliberately excluded — those belong on the
 * individual route call, not on the client wrapper.
 */
export type StickyRouteOptions = Pick<RequestOptions, 'headers' | 'signal' | 'timeout'>

/**
 * Methods available on every routes-generated client in addition to
 * the resources/methods generated from the routes registry.
 */
export type RoutesClientExtras<T> = {
  /**
   * Convenience wrapper around `withOptions({headers})`. Kept for
   * backward compatibility; new code should prefer `withOptions`.
   */
  withHeaders(headers: Record<string, string>): RoutesClientExtras<T> & T

  /**
   * Returns a same-shaped client where each route call applies the
   * provided options. Caller-supplied headers override the api-client's
   * defaults; subsequent `withOptions` calls layer headers and replace
   * signal / timeout.
   *
   * The original client is not mutated.
   */
  withOptions(options: StickyRouteOptions): RoutesClientExtras<T> & T
}

export function createClient<T>(routes: RoutesModule, options: HerokuApiClientOptions = {}): RoutesClientExtras<T> & T {
  const httpClient = new HerokuApiClient(options)
  return buildClientProxy<T>(httpClient, routes)
}

function mergeStickyOptions(
  base: StickyRouteOptions | undefined,
  next: StickyRouteOptions,
): StickyRouteOptions {
  const merged: StickyRouteOptions = {...base}
  if (next.headers || base?.headers) {
    merged.headers = {...base?.headers, ...next.headers}
  }

  // signal and timeout are not additive — last wins, but only if the
  // caller actually set them. Otherwise the previous value persists.
  if (next.signal !== undefined) merged.signal = next.signal
  if (next.timeout !== undefined) merged.timeout = next.timeout
  return merged
}

function buildClientProxy<T>(
  httpClient: HerokuApiClient,
  routes: RoutesModule,
  inheritedOptions?: StickyRouteOptions,
): RoutesClientExtras<T> & T {
  return new Proxy({}, {
    get(_target, resourceKey: string) {
      if (resourceKey === 'withOptions') {
        return (options: StickyRouteOptions) => buildClientProxy<T>(
          httpClient,
          routes,
          mergeStickyOptions(inheritedOptions, options),
        )
      }

      if (resourceKey === 'withHeaders') {
        return (headers: Record<string, string>) => buildClientProxy<T>(
          httpClient,
          routes,
          mergeStickyOptions(inheritedOptions, {headers}),
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

          return (...args: unknown[]) => dispatch(
            httpClient,
            route,
            args,
            `${resourceKey}.${methodKey}`,
            inheritedOptions,
          )
        },
      })
    },
  }) as RoutesClientExtras<T> & T
}
