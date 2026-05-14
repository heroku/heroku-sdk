import {
  describe, expect, it, vi,
} from 'vitest'

const constructorSpy = vi.fn()

vi.mock('@heroku/api-client', () => ({
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
  it("forwards service: 'platform' by default", async () => {
    constructorSpy.mockClear()
    const {createPlatformClient} = await import('./platform.js')

    createPlatformClient({token: 'test-token'})

    expect(constructorSpy).toHaveBeenCalledWith(expect.objectContaining({service: 'platform', token: 'test-token'}))
  })

  it('lets a user-supplied service override the default', async () => {
    constructorSpy.mockClear()
    const {createPlatformClient} = await import('./platform.js')

    createPlatformClient({baseUrl: 'https://example.test', service: 'custom', token: 'test-token'})

    expect(constructorSpy).toHaveBeenCalledWith(expect.objectContaining({baseUrl: 'https://example.test', service: 'custom'}))
  })
})
