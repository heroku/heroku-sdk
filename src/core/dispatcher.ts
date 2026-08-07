import type {HerokuApiClient, RequestOptions} from '@heroku/heroku-fetch'
import type {RouteDefinition} from '@heroku/types/types'

import createDebug from 'debug'

import {countPlaceholders, interpolatePath} from './interpolate-path.js'

const debug = createDebug('heroku:sdk:dispatcher')

const MAX_PAGES = 500

function hasCallerRangeHeader(requestOptions?: RequestOptions): boolean {
  if (!requestOptions?.headers) return false
  return Object.keys(requestOptions.headers).some(k => k.toLowerCase() === 'range')
}

export async function dispatch(
  client: HerokuApiClient,
  route: RouteDefinition,
  args: unknown[],
  invocation?: string,
  requestOptions?: RequestOptions,
): Promise<unknown> {
  const placeholderCount = countPlaceholders(route.path)
  const pathParams = args.slice(0, placeholderCount) as string[]
  const remaining = args.slice(placeholderCount)

  const path = interpolatePath(route.path, pathParams)

  let body: unknown
  if (route.hasRequestBody && remaining.length > 0) {
    body = remaining[0]
  }

  let effectiveOptions = requestOptions
  if (route.query && route.query.length > 0 && remaining.length > 0) {
    const raw = remaining[0]
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      const searchParams: Record<string, boolean | number | string> = {}
      for (const key of route.query) {
        const value = (raw as Record<string, unknown>)[key]
        if (value !== undefined && value !== null) {
          searchParams[key] = value as boolean | number | string
        }
      }

      effectiveOptions = {...requestOptions, searchParams}
    }
  }

  debug('%s %s %s -> %s hasBody=%s', invocation ?? 'dispatch', route.method, route.path, path, body !== undefined)

  const response = await callMethod(client, route.method, path, body, effectiveOptions)

  const contentLength = response.headers.get('content-length')
  if (response.status === 204 || contentLength === '0') {
    debug('%s empty response status=%d content-length=%s', invocation ?? 'dispatch', response.status, contentLength ?? '')
    return undefined
  }

  const result = await response.json()

  if (route.method !== 'GET' || !Array.isArray(result) || hasCallerRangeHeader(requestOptions)) {
    return result
  }

  const nextRange = response.headers.get('next-range')
  if (!nextRange) return result

  return followPages(client, path, result, nextRange, invocation, effectiveOptions)
}

/* eslint-disable no-await-in-loop -- pagination is inherently sequential; each page depends on the previous next-range header */
async function followPages(
  client: HerokuApiClient,
  path: string,
  firstPage: unknown[],
  initialRange: string,
  invocation?: string,
  requestOptions?: RequestOptions,
): Promise<unknown[]> {
  const accumulated = [...firstPage]
  let nextRange: null | string = initialRange
  let pages = 1
  while (nextRange && pages < MAX_PAGES) {
    const pageOptions: RequestOptions = {
      ...requestOptions,
      headers: {...requestOptions?.headers, Range: nextRange},
    }

    debug('%s paginate page=%d range=%s', invocation ?? 'dispatch', pages + 1, nextRange)
    const pageResponse = await callMethod(client, 'GET', path, undefined, pageOptions)
    const pageBody = await pageResponse.json()

    if (Array.isArray(pageBody)) {
      accumulated.push(...pageBody)
    }

    nextRange = pageResponse.headers.get('next-range')
    pages++
  }

  debug('%s pagination complete pages=%d total=%d', invocation ?? 'dispatch', pages, accumulated.length)
  return accumulated
}
/* eslint-enable no-await-in-loop */

function callMethod(
  client: HerokuApiClient,
  method: string,
  path: string,
  body: unknown,
  requestOptions?: RequestOptions,
): Promise<Response> {
  switch (method) {
    case 'DELETE': {
      return requestOptions ? client.delete(path, requestOptions) : client.delete(path)
    }

    case 'GET': {
      return requestOptions ? client.get(path, requestOptions) : client.get(path)
    }

    case 'PATCH': {
      return requestOptions ? client.patch(path, body, requestOptions) : client.patch(path, body)
    }

    case 'POST': {
      return requestOptions ? client.post(path, body, requestOptions) : client.post(path, body)
    }

    case 'PUT': {
      return requestOptions ? client.put(path, body, requestOptions) : client.put(path, body)
    }

    default: {
      debug('unsupported HTTP method=%s path=%s', method, path)
      throw new Error(`Unsupported HTTP method: ${method}`)
    }
  }
}
