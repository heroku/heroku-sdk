import type { HerokuApiClient, RequestOptions } from '@heroku/api-client'
import type { RouteDefinition } from '@heroku/types/3.sdk/routes'
import { interpolatePath } from './interpolate-path.js'

const PLACEHOLDER = /\{[^}]+\}/g

export async function dispatch(
  client: HerokuApiClient,
  route: RouteDefinition,
  args: unknown[],
): Promise<unknown> {
  const placeholderCount = (route.path.match(PLACEHOLDER) || []).length
  const pathParams = args.slice(0, placeholderCount) as string[]
  const remaining = args.slice(placeholderCount)

  const path = interpolatePath(route.path, pathParams)

  let body: unknown
  if (route.hasRequestBody && remaining.length > 0) {
    body = remaining[0]
  }

  const response = await callMethod(client, route.method, path, body)

  const contentLength = response.headers.get('content-length')
  if (response.status === 204 || contentLength === '0') {
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
    case 'GET': return client.get(path)
    case 'POST': return client.post(path, body)
    case 'PUT': return client.put(path, body)
    case 'PATCH': return client.patch(path, body)
    case 'DELETE': return client.delete(path)
    default: throw new Error(`Unsupported HTTP method: ${method}`)
  }
}
