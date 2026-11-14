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

vi.mock('@heroku/types/data/routes', () => ({
  addon: {
    list: {method: 'GET', path: '/addons'},
  },
}))

describe('createDataClient', () => {
  afterEach(() => {
    constructorSpy.mockClear()
  })

  it("uses heroku-fetch's 'data' service for host resolution", async () => {
    const {createDataClient} = await import('./data.js')

    createDataClient({token: 'test-token'})

    expect(constructorSpy).toHaveBeenCalledExactlyOnceWith({service: 'data', token: 'test-token'})
  })

  it('lets caller-supplied options override the service default', async () => {
    const {createDataClient} = await import('./data.js')
    const headers = {Accept: 'application/vnd.heroku+json; version=4'}
    createDataClient({
      baseUrl: 'https://example.test',
      headers,
      service: 'custom',
      token: 'test-token',
    })

    expect(constructorSpy).toHaveBeenCalledExactlyOnceWith({
      baseUrl: 'https://example.test',
      headers,
      service: 'custom',
      token: 'test-token',
    })
  })
})
