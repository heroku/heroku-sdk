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

vi.mock('@heroku/types/notifications/routes', () => ({
  notification: {
    list: {method: 'GET', path: '/user/notifications'},
  },
}))

describe('createNotificationsClient', () => {
  const OLD_ENV = process.env.HEROKU_NOTIFICATIONS_HOST
  afterEach(() => {
    if (OLD_ENV === undefined) delete process.env.HEROKU_NOTIFICATIONS_HOST
    else process.env.HEROKU_NOTIFICATIONS_HOST = OLD_ENV
    constructorSpy.mockClear()
  })

  it("defaults to service 'custom' and the telex base URL", async () => {
    delete process.env.HEROKU_NOTIFICATIONS_HOST
    constructorSpy.mockClear()
    const {createNotificationsClient} = await import('./notifications.js')

    createNotificationsClient({token: 'test-token'})

    expect(constructorSpy).toHaveBeenCalledWith(expect.objectContaining({
      baseUrl: 'https://telex.heroku.com',
      service: 'custom',
      token: 'test-token',
    }))
  })

  it('honors HEROKU_NOTIFICATIONS_HOST as a base-URL override', async () => {
    process.env.HEROKU_NOTIFICATIONS_HOST = 'https://telex.herokai.com'
    constructorSpy.mockClear()
    vi.resetModules()
    const {createNotificationsClient} = await import('./notifications.js')

    createNotificationsClient({token: 'test-token'})

    expect(constructorSpy).toHaveBeenCalledWith(expect.objectContaining({
      baseUrl: 'https://telex.herokai.com',
    }))
  })

  it('lets user-supplied baseUrl/service override the defaults', async () => {
    constructorSpy.mockClear()
    vi.resetModules()
    const {createNotificationsClient} = await import('./notifications.js')

    createNotificationsClient({baseUrl: 'https://example.test', service: 'platform', token: 'test-token'})

    expect(constructorSpy).toHaveBeenCalledWith(expect.objectContaining({
      baseUrl: 'https://example.test',
      service: 'platform',
    }))
  })
})
