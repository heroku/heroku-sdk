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

  debug('%s %s %s -> %s hasBody=%s', invocation ?? 'dispatch', route.method, route.path, path, body !== undefined)

  const response = await callMethod(client, route.method, path, body, requestOptions)

  const contentLength = response.headers.get('content-length')
  if (response.status === 204 || contentLength === '0') {
    debug('%s empty response status=%d content-length=%s', invocation ?? 'dispatch', response.status, contentLength ?? '')
    return undefined
  }

  const result = await response.json()

  if (route.method !== 'GET' || !Array.isArray(result) || hasCallerRangeHeader(requestOptions)) {
    return result
  }

  let nextRange = response.headers.get('next-range')
  if (!nextRange) return result

  const accumulated = [...result]
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
