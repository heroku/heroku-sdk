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

vi.mock('@heroku/types/data/routes', () => ({
  addon: {
    list: {method: 'GET', path: '/addons'},
  },
}))

describe('createDataClient', () => {
  it("forwards service: 'data' by default", async () => {
    constructorSpy.mockClear()
    const {createDataClient} = await import('./data.js')

    createDataClient({token: 'test-token'})

    expect(constructorSpy).toHaveBeenCalledWith(expect.objectContaining({service: 'data', token: 'test-token'}))
  })

  it('lets a user-supplied service override the default', async () => {
    constructorSpy.mockClear()
    const {createDataClient} = await import('./data.js')

    createDataClient({baseUrl: 'https://example.test', service: 'custom', token: 'test-token'})

    expect(constructorSpy).toHaveBeenCalledWith(expect.objectContaining({baseUrl: 'https://example.test', service: 'custom'}))
  })
})
