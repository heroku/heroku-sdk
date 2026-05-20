import type {HerokuApiClient} from '@heroku/heroku-fetch'
import type {RouteDefinition} from '@heroku/types/types'

import createDebug from 'debug'

import {countPlaceholders, interpolatePath} from './interpolate-path.js'

const debug = createDebug('heroku:sdk:dispatcher')

export async function dispatch(
  client: HerokuApiClient,
  route: RouteDefinition,
  args: unknown[],
  invocation?: string,
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

  const response = await callMethod(client, route.method, path, body)

  const contentLength = response.headers.get('content-length')
  if (response.status === 204 || contentLength === '0') {
    debug('%s empty response status=%d content-length=%s', invocation ?? 'dispatch', response.status, contentLength ?? '')
    return undefined
  }

  return response.json()
}

function callMethod(
  client: HerokuApiClient,
  method: string,
  path: string,
  body: unknown,
): Promise<Response> {
  switch (method) {
    case 'DELETE': {
      return client.delete(path)
    }

    case 'GET': {
      return client.get(path)
    }

    case 'PATCH': {
      return client.patch(path, body)
    }

    case 'POST': {
      return client.post(path, body)
    }

    case 'PUT': {
      return client.put(path, body)
    }

    default: {
      debug('unsupported HTTP method=%s path=%s', method, path)
      throw new Error(`Unsupported HTTP method: ${method}`)
    }
  }
}
