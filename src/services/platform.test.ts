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

vi.mock('@heroku/types/3.sdk/routes', () => ({
  app: {
    list: {method: 'GET', path: '/apps'},
  },
}))

describe('createPlatformClient', () => {
  const OLD_ENV = process.env.HEROKU_HOST
  afterEach(() => {
    if (OLD_ENV === undefined) delete process.env.HEROKU_HOST
    else process.env.HEROKU_HOST = OLD_ENV
    constructorSpy.mockClear()
  })

  it("forwards service: 'platform' by default", async () => {
    delete process.env.HEROKU_HOST
    constructorSpy.mockClear()
    const {createPlatformClient} = await import('./platform.js')

    createPlatformClient({token: 'test-token'})

    expect(constructorSpy).toHaveBeenCalledWith(expect.objectContaining({service: 'platform', token: 'test-token'}))
  })

  it('leaves baseUrl undefined when HEROKU_HOST is unset (service default applies)', async () => {
    delete process.env.HEROKU_HOST
    constructorSpy.mockClear()
    const {createPlatformClient} = await import('./platform.js')

    createPlatformClient({token: 'test-token'})

    expect(constructorSpy).toHaveBeenCalledWith(expect.objectContaining({baseUrl: undefined}))
  })

  it('maps a bare HEROKU_HOST to an api-prefixed https URL', async () => {
    process.env.HEROKU_HOST = 'staging.herokudev.com'
    constructorSpy.mockClear()
    const {createPlatformClient} = await import('./platform.js')

    createPlatformClient({token: 'test-token'})

    expect(constructorSpy).toHaveBeenCalledWith(expect.objectContaining({baseUrl: 'https://api.staging.herokudev.com'}))
  })

  it('uses a full-URL HEROKU_HOST verbatim', async () => {
    process.env.HEROKU_HOST = 'https://api.custom.example.com'
    constructorSpy.mockClear()
    const {createPlatformClient} = await import('./platform.js')

    createPlatformClient({token: 'test-token'})

    expect(constructorSpy).toHaveBeenCalledWith(expect.objectContaining({baseUrl: 'https://api.custom.example.com'}))
  })

  it('lets a caller-supplied baseUrl win over HEROKU_HOST', async () => {
    process.env.HEROKU_HOST = 'staging.herokudev.com'
    constructorSpy.mockClear()
    const {createPlatformClient} = await import('./platform.js')

    createPlatformClient({baseUrl: 'https://example.test', token: 'test-token'})

    expect(constructorSpy).toHaveBeenCalledWith(expect.objectContaining({baseUrl: 'https://example.test'}))
  })

  it('lets a user-supplied service override the default', async () => {
    constructorSpy.mockClear()
    const {createPlatformClient} = await import('./platform.js')

    createPlatformClient({baseUrl: 'https://example.test', service: 'custom', token: 'test-token'})

    expect(constructorSpy).toHaveBeenCalledWith(expect.objectContaining({baseUrl: 'https://example.test', service: 'custom'}))
  })
})
