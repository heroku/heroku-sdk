import {
  afterEach, describe, expect, it, vi,
} from 'vitest'

const constructorSpy = vi.fn()

vi.mock('@heroku/heroku-fetch', () => ({
  HerokuApiClient: class {
    constructor(options: unknown) {
      constructorSpy(options)
    }
  },
}))

vi.mock('@heroku/types/dashboard-backend/routes', () => ({
  favorite: {
    list: {method: 'GET', path: '/favorites', query: ['type']},
  },
}))

describe('createDashboardBackendClient', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    constructorSpy.mockClear()
  })

  it("uses heroku-fetch's 'particleboard' service for the host and Accept default", async () => {
    const {createDashboardBackendClient} = await import('./dashboard-backend.js')

    createDashboardBackendClient({token: 'test-token'})

    expect(constructorSpy).toHaveBeenCalledExactlyOnceWith({service: 'particleboard', token: 'test-token'})
  })

  it('leaves HEROKU_PARTICLEBOARD_URL to heroku-fetch', async () => {
    vi.stubEnv('HEROKU_PARTICLEBOARD_URL', 'https://particleboard.herokai.com')
    const {createDashboardBackendClient} = await import('./dashboard-backend.js')

    createDashboardBackendClient({token: 'test-token'})

    expect(constructorSpy).toHaveBeenCalledExactlyOnceWith({service: 'particleboard', token: 'test-token'})
  })

  it('lets caller-supplied baseUrl, service and headers win', async () => {
    const {createDashboardBackendClient} = await import('./dashboard-backend.js')
    const headers = {Accept: 'application/vnd.heroku+json; version=4'}

    createDashboardBackendClient({
      baseUrl: 'https://example.test', headers, service: 'platform', token: 't',
    })

    expect(constructorSpy).toHaveBeenCalledExactlyOnceWith({
      baseUrl: 'https://example.test', headers, service: 'platform', token: 't',
    })
  })

  it('passes token and headers through unchanged', async () => {
    const {createDashboardBackendClient} = await import('./dashboard-backend.js')
    const headers = {Accept: 'application/json', 'X-Request-ID': 'request-1'}

    createDashboardBackendClient({headers, token: 'test-token'})

    expect(constructorSpy).toHaveBeenCalledWith(expect.objectContaining({
      headers,
      token: 'test-token',
    }))
  })
})
