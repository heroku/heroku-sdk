import {
  describe, expect, it, vi,
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
  it("defaults to service 'custom' and the kolkrabbi base URL", async () => {
    constructorSpy.mockClear()
    const {createRepositoriesClient} = await import('./repositories.js')

    createRepositoriesClient({token: 'test-token'})

    expect(constructorSpy).toHaveBeenCalledWith(expect.objectContaining({
      baseUrl: 'https://kolkrabbi.heroku.com',
      service: 'custom',
      token: 'test-token',
    }))
  })

  it('lets user-supplied baseUrl/service override the defaults', async () => {
    constructorSpy.mockClear()
    const {createRepositoriesClient} = await import('./repositories.js')

    createRepositoriesClient({baseUrl: 'https://example.test', service: 'platform', token: 'test-token'})

    expect(constructorSpy).toHaveBeenCalledWith(expect.objectContaining({
      baseUrl: 'https://example.test',
      service: 'platform',
    }))
  })
})
