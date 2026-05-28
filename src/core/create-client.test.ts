import {
  describe, expect, it, vi,
} from 'vitest'

import {createClient} from './create-client.js'

function mockResponse(body: unknown, status = 200): Response {
  return {
    headers: new Headers({'content-length': '100'}),
    json: () => Promise.resolve(body),
    status,
  } as unknown as Response
}

// Track HerokuApiClient instances so tests can assert call args.
const apiClientInstances: any[] = []

vi.mock('@heroku/heroku-fetch', () => ({
  HerokuApiClient: class {
    delete = vi.fn().mockResolvedValue(mockResponse({id: '1'}))
    get = vi.fn().mockResolvedValue(mockResponse([{id: '1', name: 'my-app'}]))
    patch = vi.fn().mockResolvedValue(mockResponse({id: '1', name: 'updated'}))
    post = vi.fn().mockResolvedValue(mockResponse({id: '2', name: 'new-app'}, 201))

    constructor() {
      apiClientInstances.push(this)
    }
  },
}))

const fakeRoutes = {
  accountFeature: {
    update: {hasRequestBody: true, method: 'PATCH', path: '/account/features/{accountFeatureIdentity}'},
  },
  app: {
    create: {hasRequestBody: true, method: 'POST', path: '/apps'},
    delete: {method: 'DELETE', path: '/apps/{appIdentity}'},
    info: {method: 'GET', path: '/apps/{appIdentity}'},
    list: {method: 'GET', path: '/apps'},
  },
}

describe('createClient', () => {
  it('returns an object with resource namespaces matching the supplied routes', () => {
    const client = createClient<any>(fakeRoutes, {token: 'test-token'})
    expect(client.app).toBeDefined()
    expect(client.accountFeature).toBeDefined()
  })

  it('returns undefined for unknown resource keys', () => {
    const client = createClient<any>(fakeRoutes, {token: 'test-token'})
    expect(client.nonExistent).toBeUndefined()
  })

  it('returns undefined for unknown method keys', () => {
    const client = createClient<any>(fakeRoutes, {token: 'test-token'})
    expect(client.app.nonExistent).toBeUndefined()
  })

  it('dispatches list call as GET to correct path', async () => {
    const client = createClient<any>(fakeRoutes, {token: 'test-token'})
    const result = await client.app.list()
    expect(result).toEqual([{id: '1', name: 'my-app'}])
  })

  it('dispatches create call as POST with body', async () => {
    const client = createClient<any>(fakeRoutes, {token: 'test-token'})
    const result = await client.app.create({name: 'new-app'})
    expect(result).toEqual({id: '2', name: 'new-app'})
  })

  it('dispatches info call with path parameter', async () => {
    const client = createClient<any>(fakeRoutes, {token: 'test-token'})
    const result = await client.app.info('my-app')
    expect(result).toEqual([{id: '1', name: 'my-app'}])
  })

  it('dispatches update call with path param and body', async () => {
    const client = createClient<any>(fakeRoutes, {token: 'test-token'})
    const result = await client.accountFeature.update('my-feature', {enabled: true})
    expect(result).toEqual({id: '1', name: 'updated'})
  })

  describe('withHeaders', () => {
    it('returns a same-shaped client without mutating the original', () => {
      const client = createClient<any>(fakeRoutes, {token: 'test-token'})
      const scoped = client.withHeaders({Accept: 'application/vnd.heroku+json; version=3.sdk'})

      expect(scoped).not.toBe(client)
      expect(typeof scoped.app.list).toBe('function')
      expect(typeof scoped.withHeaders).toBe('function')
    })

    it('forwards the headers as RequestOptions on each call', async () => {
      apiClientInstances.length = 0
      const client = createClient<any>(fakeRoutes, {token: 'test-token'})
      const scoped = client.withHeaders({Accept: 'application/vnd.heroku+json; version=3.sdk'})

      await scoped.app.list()

      const apiClient = apiClientInstances.at(-1)
      expect(apiClient.get).toHaveBeenCalledWith('/apps', {
        headers: {Accept: 'application/vnd.heroku+json; version=3.sdk'},
      })
    })

    it('does not forward request options when no withHeaders is in play', async () => {
      apiClientInstances.length = 0
      const client = createClient<any>(fakeRoutes, {token: 'test-token'})

      await client.app.list()

      const apiClient = apiClientInstances.at(-1)
      expect(apiClient.get).toHaveBeenCalledWith('/apps')
    })

    it('layers headers on subsequent withHeaders calls', async () => {
      apiClientInstances.length = 0
      const client = createClient<any>(fakeRoutes, {token: 'test-token'})
      const layered = client
        .withHeaders({Accept: 'a', 'X-A': '1'})
        .withHeaders({Accept: 'b', 'X-B': '2'})

      await layered.app.list()

      const apiClient = apiClientInstances.at(-1)
      expect(apiClient.get).toHaveBeenCalledWith('/apps', {
        headers: {Accept: 'b', 'X-A': '1', 'X-B': '2'},
      })
    })
  })

  describe('withOptions', () => {
    it('returns a same-shaped client without mutating the original', () => {
      const client = createClient<any>(fakeRoutes, {token: 'test-token'})
      const scoped = client.withOptions({timeout: 5000})

      expect(scoped).not.toBe(client)
      expect(typeof scoped.app.list).toBe('function')
      expect(typeof scoped.withOptions).toBe('function')
      expect(typeof scoped.withHeaders).toBe('function')
    })

    it('forwards a signal as RequestOptions on each call', async () => {
      apiClientInstances.length = 0
      const client = createClient<any>(fakeRoutes, {token: 'test-token'})
      const controller = new AbortController()
      const scoped = client.withOptions({signal: controller.signal})

      await scoped.app.list()

      const apiClient = apiClientInstances.at(-1)
      expect(apiClient.get).toHaveBeenCalledWith('/apps', {signal: controller.signal})
    })

    it('forwards headers, signal, and timeout together', async () => {
      apiClientInstances.length = 0
      const client = createClient<any>(fakeRoutes, {token: 'test-token'})
      const controller = new AbortController()
      const scoped = client.withOptions({
        headers: {Accept: 'application/vnd.heroku+json; version=3.sdk'},
        signal: controller.signal,
        timeout: 5000,
      })

      await scoped.app.list()

      const apiClient = apiClientInstances.at(-1)
      expect(apiClient.get).toHaveBeenCalledWith('/apps', {
        headers: {Accept: 'application/vnd.heroku+json; version=3.sdk'},
        signal: controller.signal,
        timeout: 5000,
      })
    })

    it('layers headers and replaces signal/timeout across chained calls', async () => {
      apiClientInstances.length = 0
      const client = createClient<any>(fakeRoutes, {token: 'test-token'})
      const firstSignal = new AbortController().signal
      const secondSignal = new AbortController().signal
      const layered = client
        .withOptions({headers: {Accept: 'a', 'X-A': '1'}, signal: firstSignal, timeout: 1000})
        .withOptions({headers: {Accept: 'b', 'X-B': '2'}, signal: secondSignal, timeout: 2000})

      await layered.app.list()

      const apiClient = apiClientInstances.at(-1)
      expect(apiClient.get).toHaveBeenCalledWith('/apps', {
        headers: {Accept: 'b', 'X-A': '1', 'X-B': '2'},
        signal: secondSignal,
        timeout: 2000,
      })
    })

    it('preserves earlier signal/timeout when subsequent withOptions does not set them', async () => {
      apiClientInstances.length = 0
      const client = createClient<any>(fakeRoutes, {token: 'test-token'})
      const controller = new AbortController()
      const layered = client
        .withOptions({signal: controller.signal, timeout: 1000})
        .withOptions({headers: {Accept: 'b'}})

      await layered.app.list()

      const apiClient = apiClientInstances.at(-1)
      expect(apiClient.get).toHaveBeenCalledWith('/apps', {
        headers: {Accept: 'b'},
        signal: controller.signal,
        timeout: 1000,
      })
    })

    it('composes withOptions and withHeaders', async () => {
      apiClientInstances.length = 0
      const client = createClient<any>(fakeRoutes, {token: 'test-token'})
      const controller = new AbortController()
      const composed = client
        .withOptions({signal: controller.signal})
        .withHeaders({Accept: 'application/vnd.heroku+json; version=3.sdk'})

      await composed.app.list()

      const apiClient = apiClientInstances.at(-1)
      expect(apiClient.get).toHaveBeenCalledWith('/apps', {
        headers: {Accept: 'application/vnd.heroku+json; version=3.sdk'},
        signal: controller.signal,
      })
    })
  })
})
