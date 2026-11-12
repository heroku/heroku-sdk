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
  afterEach(() => {
    vi.unstubAllEnvs()
    constructorSpy.mockClear()
  })

  it("uses heroku-fetch's 'notifications' service for the host and Accept default", async () => {
    const {createNotificationsClient} = await import('./notifications.js')

    createNotificationsClient({token: 'test-token'})

    expect(constructorSpy).toHaveBeenCalledExactlyOnceWith({service: 'notifications', token: 'test-token'})
  })

  it('leaves HEROKU_NOTIFICATIONS_HOST to heroku-fetch', async () => {
    vi.stubEnv('HEROKU_NOTIFICATIONS_HOST', 'https://telex.herokai.com')
    const {createNotificationsClient} = await import('./notifications.js')

    createNotificationsClient({token: 'test-token'})

    expect(constructorSpy).toHaveBeenCalledExactlyOnceWith({service: 'notifications', token: 'test-token'})
  })

  it('lets caller-supplied baseUrl, service and headers win', async () => {
    const {createNotificationsClient} = await import('./notifications.js')
    const headers = {Accept: 'application/vnd.heroku+json; version=4'}

    createNotificationsClient({
      baseUrl: 'https://example.test', headers, service: 'platform', token: 't',
    })

    expect(constructorSpy).toHaveBeenCalledExactlyOnceWith({
      baseUrl: 'https://example.test', headers, service: 'platform', token: 't',
    })
  })
})
