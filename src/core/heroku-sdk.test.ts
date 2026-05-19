import {
  afterEach, describe, expect, it, vi,
} from 'vitest'

const platformConstructorSpy = vi.fn()
const dataConstructorSpy = vi.fn()

vi.mock('@heroku/api-client', () => ({
  HerokuApiClient: class {
    constructor(options: unknown) {
      // The same constructor is used for platform and data; spies are
      // distinguished by the service field in options.
      const {service} = (options as {service?: string})
      if (service === 'platform') platformConstructorSpy(options)
      else if (service === 'data') dataConstructorSpy(options)
    }
  },
}))

vi.mock('@heroku/types/3.sdk/routes', () => ({
  app: {
    update: {hasRequestBody: true, method: 'PATCH', path: '/apps/{appIdentity}'},
  },
}))

vi.mock('@heroku/types/data/routes', () => ({
  database: {
    info: {method: 'GET', path: '/databases/{databaseIdentity}'},
  },
}))

describe('HerokuSDK', () => {
  afterEach(() => {
    platformConstructorSpy.mockClear()
    dataConstructorSpy.mockClear()
    vi.resetModules()
  })

  it('constructs no service clients eagerly', async () => {
    const {HerokuSDK} = await import('./heroku-sdk.js')

    const sdk = new HerokuSDK()
    expect(sdk).toBeDefined()

    expect(platformConstructorSpy).not.toHaveBeenCalled()
    expect(dataConstructorSpy).not.toHaveBeenCalled()
  })

  it('lazily constructs the platform client on first access', async () => {
    const {HerokuSDK} = await import('./heroku-sdk.js')
    const sdk = new HerokuSDK({clientOptions: {token: 'abc'}})

    const _touch = sdk.platform
    expect(_touch).toBeDefined()

    expect(platformConstructorSpy).toHaveBeenCalledTimes(1)
    expect(platformConstructorSpy).toHaveBeenCalledWith(expect.objectContaining({
      service: 'platform',
      token: 'abc',
    }))
    expect(dataConstructorSpy).not.toHaveBeenCalled()
  })

  it('memoizes service clients across repeated access', async () => {
    const {HerokuSDK} = await import('./heroku-sdk.js')
    const sdk = new HerokuSDK()

    const a = sdk.platform
    const b = sdk.platform

    expect(a).toBe(b)
    expect(platformConstructorSpy).toHaveBeenCalledTimes(1)
  })

  it('routes extension methods through the merged proxy', async () => {
    const {HerokuSDK} = await import('./heroku-sdk.js')
    const {extendResource} = await import('./extend-resource.js')

    const ext = extendResource('platform', 'app', () => ({
      enableMaintenance: () => 'maintenance-on',
    }))

    const sdk = new HerokuSDK({extensions: [ext]})

    // Cast to bypass overly-narrow inferred types for the test.
    const result = (sdk.platform.app as unknown as {enableMaintenance: () => string}).enableMaintenance()
    expect(result).toBe('maintenance-on')
  })

  it('partitions extensions by service so platform extensions do not leak into data', async () => {
    const {HerokuSDK} = await import('./heroku-sdk.js')
    const {extendResource} = await import('./extend-resource.js')

    const platformExt = extendResource('platform', 'app', () => ({onlyPlatform: () => 'p'}))
    const dataExt = extendResource('data', 'database', () => ({onlyData: () => 'd'}))

    const sdk = new HerokuSDK({extensions: [platformExt, dataExt]})

    expect((sdk.platform.app as unknown as {onlyPlatform: () => string}).onlyPlatform()).toBe('p')
    expect((sdk.data.database as unknown as {onlyData: () => string}).onlyData()).toBe('d')
    // Platform extension does not appear on data.app, and data extension does not appear on platform.database.
    expect((sdk.data as unknown as {app?: unknown}).app).toBeUndefined()
    expect((sdk.platform as unknown as {database?: unknown}).database).toBeUndefined()
  })
})
