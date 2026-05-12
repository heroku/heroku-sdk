import {
  describe, expect, it, vi,
} from 'vitest'

import {createClient, createHerokuClient} from './create-client.js'

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

function mockResponse(body: unknown, status = 200): Response {
  return {
    headers: new Headers({'content-length': '100'}),
    json: () => Promise.resolve(body),
    status,
  } as unknown as Response
}

vi.mock('@heroku/api-client', () => ({
  HerokuApiClient: class {
    delete = vi.fn().mockResolvedValue(mockResponse({id: '1'}))
    get = vi.fn().mockResolvedValue(mockResponse([{id: '1', name: 'my-app'}]))
    patch = vi.fn().mockResolvedValue(mockResponse({id: '1', name: 'updated'}))
    post = vi.fn().mockResolvedValue(mockResponse({id: '2', name: 'new-app'}, 201))
  },
}))

vi.mock('@heroku/types/3.sdk/routes', () => ({
  accountFeature: {
    update: {hasRequestBody: true, method: 'PATCH', path: '/account/features/{accountFeatureIdentity}'},
  },
  app: {
    create: {hasRequestBody: true, method: 'POST', path: '/apps'},
    delete: {method: 'DELETE', path: '/apps/{appIdentity}'},
    info: {method: 'GET', path: '/apps/{appIdentity}'},
    list: {method: 'GET', path: '/apps'},
  },
}))

describe('createHerokuClient', () => {
  it('returns an object with resource namespaces matching the route registry', () => {
    const client = createHerokuClient({token: 'test-token'})
    expect(client.app).toBeDefined()
    expect(client.accountFeature).toBeDefined()
  })

  it('returns undefined for unknown resource keys', () => {
    const client = createHerokuClient({token: 'test-token'})
    expect((client as any).nonExistent).toBeUndefined()
  })

  it('returns undefined for unknown method keys', () => {
    const client = createHerokuClient({token: 'test-token'})
    expect((client.app as any).nonExistent).toBeUndefined()
  })

  it('dispatches list call as GET to correct path', async () => {
    const client = createHerokuClient({token: 'test-token'})
    const result = await client.app.list()
    expect(result).toEqual([{id: '1', name: 'my-app'}])
  })

  it('dispatches create call as POST with body', async () => {
    const client = createHerokuClient({token: 'test-token'})
    const result = await client.app.create({name: 'new-app'} as any)
    expect(result).toEqual({id: '2', name: 'new-app'})
  })

  it('dispatches info call with path parameter', async () => {
    const client = createHerokuClient({token: 'test-token'})
    const result = await client.app.info('my-app')
    expect(result).toEqual([{id: '1', name: 'my-app'}])
  })

  it('dispatches update call with path param and body', async () => {
    const client = createHerokuClient({token: 'test-token'})
    const result = await client.accountFeature.update('my-feature', {enabled: true})
    expect(result).toEqual({id: '1', name: 'updated'})
  })
})

// eslint-disable-next-line mocha/max-top-level-suites
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
})
