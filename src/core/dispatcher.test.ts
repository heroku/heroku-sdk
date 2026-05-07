import type {RouteDefinition} from '@heroku/types/3.sdk/routes'

import {
  describe, expect, it, vi,
} from 'vitest'

import {dispatch} from './dispatcher.js'

function mockResponse(body: unknown, status = 200): Response {
  return {
    headers: new Headers({'content-length': JSON.stringify(body).length.toString()}),
    json: () => Promise.resolve(body),
    status,
  } as unknown as Response
}

function mockEmptyResponse(): Response {
  return {
    headers: new Headers(),
    json: () => Promise.resolve(),
    status: 204,
  } as unknown as Response
}

function mockClient() {
  return {
    delete: vi.fn().mockResolvedValue(mockResponse({id: '5'})),
    get: vi.fn().mockResolvedValue(mockResponse({id: '1'})),
    patch: vi.fn().mockResolvedValue(mockResponse({id: '4'})),
    post: vi.fn().mockResolvedValue(mockResponse({id: '2'})),
    put: vi.fn().mockResolvedValue(mockResponse({id: '3'})),
  }
}

describe('dispatch', () => {
  it('calls client.get for GET routes', async () => {
    const client = mockClient()
    const route: RouteDefinition = {method: 'GET', path: '/apps'}

    const result = await dispatch(client as any, route, [])
    expect(client.get).toHaveBeenCalledWith('/apps')
    expect(result).toEqual({id: '1'})
  })

  it('calls client.post for POST routes with body', async () => {
    const client = mockClient()
    const route: RouteDefinition = {hasRequestBody: true, method: 'POST', path: '/apps'}
    const body = {name: 'my-app'}

    await dispatch(client as any, route, [body])
    expect(client.post).toHaveBeenCalledWith('/apps', body)
  })

  it('calls client.patch for PATCH routes with body', async () => {
    const client = mockClient()
    const route: RouteDefinition = {hasRequestBody: true, method: 'PATCH', path: '/apps/{appIdentity}'}
    const body = {name: 'new-name'}

    await dispatch(client as any, route, ['my-app', body])
    expect(client.patch).toHaveBeenCalledWith('/apps/my-app', body)
  })

  it('calls client.put for PUT routes with body', async () => {
    const client = mockClient()
    const route: RouteDefinition = {hasRequestBody: true, method: 'PUT', path: '/apps/{appIdentity}'}
    const body = {name: 'new-name'}

    await dispatch(client as any, route, ['my-app', body])
    expect(client.put).toHaveBeenCalledWith('/apps/my-app', body)
  })

  it('calls client.delete for DELETE routes', async () => {
    const client = mockClient()
    const route: RouteDefinition = {method: 'DELETE', path: '/apps/{appIdentity}'}

    await dispatch(client as any, route, ['my-app'])
    expect(client.delete).toHaveBeenCalledWith('/apps/my-app')
  })

  it('interpolates multiple path params positionally', async () => {
    const client = mockClient()
    const route: RouteDefinition = {method: 'GET', path: '/apps/{appIdentity}/dynos/{dynoIdentity}'}

    await dispatch(client as any, route, ['my-app', 'web.1'])
    expect(client.get).toHaveBeenCalledWith('/apps/my-app/dynos/web.1')
  })

  it('returns parsed JSON from response', async () => {
    const client = mockClient()
    const route: RouteDefinition = {method: 'GET', path: '/apps'}

    const result = await dispatch(client as any, route, [])
    expect(result).toEqual({id: '1'})
  })

  it('returns undefined for 204 responses', async () => {
    const client = {
      ...mockClient(),
      delete: vi.fn().mockResolvedValue(mockEmptyResponse()),
    }
    const route: RouteDefinition = {method: 'DELETE', path: '/apps/{appIdentity}'}

    const result = await dispatch(client as any, route, ['my-app'])
    expect(result).toBeUndefined()
  })

  it('throws for unsupported HTTP method', async () => {
    const client = mockClient()
    const route = {method: 'OPTIONS', path: '/apps'} as unknown as RouteDefinition

    await expect(dispatch(client as any, route, [])).rejects.toThrow('Unsupported HTTP method: OPTIONS')
  })
})
