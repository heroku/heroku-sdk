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
  afterEach(() => {
    vi.unstubAllEnvs()
    constructorSpy.mockClear()
  })

  it("uses heroku-fetch's 'repositories' service for the host and Accept default", async () => {
    const {createRepositoriesClient} = await import('./repositories.js')

    createRepositoriesClient({token: 'test-token'})

    expect(constructorSpy).toHaveBeenCalledExactlyOnceWith({service: 'repositories', token: 'test-token'})
  })

  it('leaves HEROKU_REPOSITORIES_HOST to heroku-fetch', async () => {
    vi.stubEnv('HEROKU_REPOSITORIES_HOST', 'https://kolkrabbi.herokai.com')
    const {createRepositoriesClient} = await import('./repositories.js')

    createRepositoriesClient({token: 'test-token'})

    expect(constructorSpy).toHaveBeenCalledExactlyOnceWith({service: 'repositories', token: 'test-token'})
  })

  it('lets caller-supplied baseUrl, service and headers win', async () => {
    const {createRepositoriesClient} = await import('./repositories.js')
    const headers = {Accept: 'application/vnd.heroku+json; version=4'}

    createRepositoriesClient({
      baseUrl: 'https://example.test', headers, service: 'platform', token: 't',
    })

    expect(constructorSpy).toHaveBeenCalledExactlyOnceWith({
      baseUrl: 'https://example.test', headers, service: 'platform', token: 't',
    })
  })
})
