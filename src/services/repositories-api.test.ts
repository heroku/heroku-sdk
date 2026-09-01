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

vi.mock('@heroku/types/repositories-api/routes', () => ({
  githubRepository: {
    info: {method: 'GET', path: '/pipelines/{pipelineIdentity}/repo'},
  },
}))

describe('createRepositoriesApiClient', () => {
  it('uses the Platform service and repositories API media type by default', async () => {
    constructorSpy.mockClear()
    const {createRepositoriesApiClient} = await import('./repositories-api.js')

    createRepositoriesApiClient({token: 'test-token'})

    expect(constructorSpy).toHaveBeenCalledWith(expect.objectContaining({
      defaultAccept: 'application/vnd.heroku+json; version=3.repositories-api',
      service: 'platform',
      token: 'test-token',
    }))
  })

  it('lets caller options override the service defaults', async () => {
    constructorSpy.mockClear()
    const {createRepositoriesApiClient} = await import('./repositories-api.js')

    createRepositoriesApiClient({
      baseUrl: 'https://example.test',
      defaultAccept: 'application/json',
      service: 'custom',
    })

    expect(constructorSpy).toHaveBeenCalledWith(expect.objectContaining({
      baseUrl: 'https://example.test',
      defaultAccept: 'application/json',
      service: 'custom',
    }))
  })
})
