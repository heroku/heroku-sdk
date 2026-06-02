import type {RouteDefinition} from '@heroku/types/3.sdk/routes'

import {
  describe, expect, it, vi,
} from 'vitest'

import {dispatch} from './dispatcher.js'

function mockResponse(body: unknown, status = 200, extraHeaders?: Record<string, string>): Response {
  const headers = new Headers({'content-length': JSON.stringify(body).length.toString(), ...extraHeaders})
  return {
    headers,
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

  describe('auto-pagination', () => {
    it('follows next-range headers for GET requests returning arrays', async () => {
      const page1 = mockResponse([{id: '1'}, {id: '2'}], 200, {'next-range': 'id 3..'})
      const page2 = mockResponse([{id: '3'}, {id: '4'}], 200)
      const client = {...mockClient(), get: vi.fn().mockResolvedValueOnce(page1).mockResolvedValueOnce(page2)}
      const route: RouteDefinition = {method: 'GET', path: '/apps'}

      const result = await dispatch(client as any, route, [])

      expect(result).toEqual([{id: '1'}, {id: '2'}, {id: '3'}, {id: '4'}])
      expect(client.get).toHaveBeenCalledTimes(2)
      expect(client.get).toHaveBeenNthCalledWith(2, '/apps', {headers: {Range: 'id 3..'}})
    })

    it('follows multiple pages until next-range disappears', async () => {
      const page1 = mockResponse([{id: '1'}], 200, {'next-range': 'id 2..'})
      const page2 = mockResponse([{id: '2'}], 200, {'next-range': 'id 3..'})
      const page3 = mockResponse([{id: '3'}], 200)
      const client = {
        ...mockClient(),
        get: vi.fn().mockResolvedValueOnce(page1).mockResolvedValueOnce(page2).mockResolvedValueOnce(page3),
      }
      const route: RouteDefinition = {method: 'GET', path: '/apps'}

      const result = await dispatch(client as any, route, [])

      expect(result).toEqual([{id: '1'}, {id: '2'}, {id: '3'}])
      expect(client.get).toHaveBeenCalledTimes(3)
    })

    it('does not paginate when caller supplies a Range header', async () => {
      const page1 = mockResponse([{id: '1'}], 200, {'next-range': 'id 2..'})
      const client = {...mockClient(), get: vi.fn().mockResolvedValueOnce(page1)}
      const route: RouteDefinition = {method: 'GET', path: '/apps'}

      const result = await dispatch(client as any, route, [], undefined, {headers: {Range: 'id ..; max=1'}})

      expect(result).toEqual([{id: '1'}])
      expect(client.get).toHaveBeenCalledTimes(1)
    })

    it('does not paginate when caller supplies a lowercase range header', async () => {
      const page1 = mockResponse([{id: '1'}], 200, {'next-range': 'id 2..'})
      const client = {...mockClient(), get: vi.fn().mockResolvedValueOnce(page1)}
      const route: RouteDefinition = {method: 'GET', path: '/apps'}

      const result = await dispatch(client as any, route, [], undefined, {headers: {range: 'id ..; max=1'}})

      expect(result).toEqual([{id: '1'}])
      expect(client.get).toHaveBeenCalledTimes(1)
    })

    it('does not paginate non-array responses', async () => {
      const response = mockResponse({id: '1', name: 'my-app'}, 200, {'next-range': 'id 2..'})
      const client = {...mockClient(), get: vi.fn().mockResolvedValueOnce(response)}
      const route: RouteDefinition = {method: 'GET', path: '/apps/{appIdentity}'}

      const result = await dispatch(client as any, route, ['my-app'])

      expect(result).toEqual({id: '1', name: 'my-app'})
      expect(client.get).toHaveBeenCalledTimes(1)
    })

    it('does not paginate non-GET methods', async () => {
      const response = mockResponse([{id: '1'}], 200, {'next-range': 'id 2..'})
      const client = {...mockClient(), post: vi.fn().mockResolvedValueOnce(response)}
      const route: RouteDefinition = {hasRequestBody: true, method: 'POST', path: '/apps'}

      const result = await dispatch(client as any, route, [{name: 'app'}])

      expect(result).toEqual([{id: '1'}])
      expect(client.post).toHaveBeenCalledTimes(1)
    })

    it('preserves existing requestOptions when paginating', async () => {
      const page1 = mockResponse([{id: '1'}], 200, {'next-range': 'id 2..'})
      const page2 = mockResponse([{id: '2'}], 200)
      const client = {...mockClient(), get: vi.fn().mockResolvedValueOnce(page1).mockResolvedValueOnce(page2)}
      const route: RouteDefinition = {method: 'GET', path: '/apps'}

      await dispatch(client as any, route, [], undefined, {headers: {Accept: 'application/json'}, timeout: 5000})

      expect(client.get).toHaveBeenNthCalledWith(2, '/apps', {
        headers: {Accept: 'application/json', Range: 'id 2..'},
        timeout: 5000,
      })
    })

    it('returns first page if no next-range header present', async () => {
      const response = mockResponse([{id: '1'}, {id: '2'}], 200)
      const client = {...mockClient(), get: vi.fn().mockResolvedValueOnce(response)}
      const route: RouteDefinition = {method: 'GET', path: '/apps'}

      const result = await dispatch(client as any, route, [])

      expect(result).toEqual([{id: '1'}, {id: '2'}])
      expect(client.get).toHaveBeenCalledTimes(1)
    })

    it('stops paginating after 500 pages to prevent infinite loops', async () => {
      const alwaysPaginates = () => mockResponse([{id: 'x'}], 200, {'next-range': 'id next..'})
      const client = {...mockClient(), get: vi.fn().mockImplementation(alwaysPaginates)}
      const route: RouteDefinition = {method: 'GET', path: '/apps'}

      const result = await dispatch(client as any, route, [])

      expect(Array.isArray(result)).toBe(true)
      expect((result as unknown[]).length).toBe(500)
      expect(client.get).toHaveBeenCalledTimes(500)
    })
  })
})
