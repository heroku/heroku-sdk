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

vi.mock('@heroku/types/repositories/routes', () => ({
  account: {
    infoWithToken: {method: 'GET', path: '/account/github/token'},
  },
}))

describe('createRepositoriesClient', () => {
  const OLD_ENV = process.env.HEROKU_REPOSITORIES_HOST
  afterEach(() => {
    if (OLD_ENV === undefined) delete process.env.HEROKU_REPOSITORIES_HOST
    else process.env.HEROKU_REPOSITORIES_HOST = OLD_ENV
    constructorSpy.mockClear()
  })

  it("defaults to service 'custom' and the kolkrabbi base URL", async () => {
    delete process.env.HEROKU_REPOSITORIES_HOST
    constructorSpy.mockClear()
    const {createRepositoriesClient} = await import('./repositories.js')

    createRepositoriesClient({token: 'test-token'})

    expect(constructorSpy).toHaveBeenCalledWith(expect.objectContaining({
      baseUrl: 'https://kolkrabbi.heroku.com',
      service: 'custom',
      token: 'test-token',
    }))
  })

  it('honors HEROKU_REPOSITORIES_HOST as a base-URL override', async () => {
    process.env.HEROKU_REPOSITORIES_HOST = 'https://kolkrabbi.herokai.com'
    constructorSpy.mockClear()
    vi.resetModules()
    const {createRepositoriesClient} = await import('./repositories.js')

    createRepositoriesClient({token: 'test-token'})

    expect(constructorSpy).toHaveBeenCalledWith(expect.objectContaining({
      baseUrl: 'https://kolkrabbi.herokai.com',
    }))
  })

  it('lets user-supplied baseUrl/service override the defaults', async () => {
    constructorSpy.mockClear()
    vi.resetModules()
    const {createRepositoriesClient} = await import('./repositories.js')

    createRepositoriesClient({baseUrl: 'https://example.test', service: 'platform', token: 'test-token'})

    expect(constructorSpy).toHaveBeenCalledWith(expect.objectContaining({
      baseUrl: 'https://example.test',
      service: 'platform',
    }))
  })
})
