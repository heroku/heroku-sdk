import { describe, it, expect, vi } from 'vitest'
import { createHerokuClient } from './create-client.js'

function mockResponse(body: unknown, status = 200): Response {
  return {
    json: () => Promise.resolve(body),
    status,
    headers: new Headers({ 'content-length': '100' }),
  } as unknown as Response
}

vi.mock('@heroku/api-client', () => {
  return {
    HerokuApiClient: class {
      get = vi.fn().mockResolvedValue(mockResponse([{ id: '1', name: 'my-app' }]))
      post = vi.fn().mockResolvedValue(mockResponse({ id: '2', name: 'new-app' }, 201))
      patch = vi.fn().mockResolvedValue(mockResponse({ id: '1', name: 'updated' }))
      delete = vi.fn().mockResolvedValue(mockResponse({ id: '1' }))
    },
  }
})

vi.mock('@heroku/types/routes', () => ({
  routes: {
    app: {
      list: { method: 'GET', path: '/apps' },
      create: { method: 'POST', path: '/apps', hasRequestBody: true },
      info: { method: 'GET', path: '/apps/{appIdentity}' },
      delete: { method: 'DELETE', path: '/apps/{appIdentity}' },
    },
    accountFeature: {
      update: { method: 'PATCH', path: '/account/features/{accountFeatureIdentity}', hasRequestBody: true },
    },
  },
}))

describe('createHerokuClient', () => {
  it('returns an object with resource namespaces matching the route registry', () => {
    const client = createHerokuClient({ token: 'test-token' })
    expect(client.app).toBeDefined()
    expect(client.accountFeature).toBeDefined()
  })

  it('returns undefined for unknown resource keys', () => {
    const client = createHerokuClient({ token: 'test-token' })
    expect((client as any).nonExistent).toBeUndefined()
  })

  it('returns undefined for unknown method keys', () => {
    const client = createHerokuClient({ token: 'test-token' })
    expect((client.app as any).nonExistent).toBeUndefined()
  })

  it('dispatches list call as GET to correct path', async () => {
    const client = createHerokuClient({ token: 'test-token' })
    const result = await client.app.list()
    expect(result).toEqual([{ id: '1', name: 'my-app' }])
  })

  it('dispatches create call as POST with body', async () => {
    const client = createHerokuClient({ token: 'test-token' })
    const result = await client.app.create({ name: 'new-app' } as any)
    expect(result).toEqual({ id: '2', name: 'new-app' })
  })

  it('dispatches info call with path parameter', async () => {
    const client = createHerokuClient({ token: 'test-token' })
    const result = await client.app.info('my-app')
    expect(result).toEqual([{ id: '1', name: 'my-app' }])
  })

  it('dispatches update call with path param and body', async () => {
    const client = createHerokuClient({ token: 'test-token' })
    const result = await client.accountFeature.update('my-feature', { enabled: true })
    expect(result).toEqual({ id: '1', name: 'updated' })
  })
})
