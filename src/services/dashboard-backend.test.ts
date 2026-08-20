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
  const oldUrl = process.env.HEROKU_PARTICLEBOARD_URL

  afterEach(() => {
    if (oldUrl === undefined) delete process.env.HEROKU_PARTICLEBOARD_URL
    else process.env.HEROKU_PARTICLEBOARD_URL = oldUrl
    constructorSpy.mockClear()
  })

  it("defaults to service 'particleboard' without overriding its configured base URL", async () => {
    delete process.env.HEROKU_PARTICLEBOARD_URL
    const {createDashboardBackendClient} = await import('./dashboard-backend.js')

    createDashboardBackendClient({token: 'test-token'})

    expect(constructorSpy).toHaveBeenCalledWith({
      service: 'particleboard',
      token: 'test-token',
    })
  })

  it('honors HEROKU_PARTICLEBOARD_URL as a base-URL override', async () => {
    process.env.HEROKU_PARTICLEBOARD_URL = 'https://particleboard.herokai.com'
    const {createDashboardBackendClient} = await import('./dashboard-backend.js')

    createDashboardBackendClient({token: 'test-token'})

    expect(constructorSpy).toHaveBeenCalledWith(expect.objectContaining({
      baseUrl: 'https://particleboard.herokai.com',
    }))
  })

  it('lets caller-supplied baseUrl and service override the defaults', async () => {
    process.env.HEROKU_PARTICLEBOARD_URL = 'https://particleboard.herokai.com'
    const {createDashboardBackendClient} = await import('./dashboard-backend.js')

    createDashboardBackendClient({baseUrl: 'https://example.test', service: 'platform', token: 'test-token'})

    expect(constructorSpy).toHaveBeenCalledWith(expect.objectContaining({
      baseUrl: 'https://example.test',
      service: 'platform',
    }))
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
