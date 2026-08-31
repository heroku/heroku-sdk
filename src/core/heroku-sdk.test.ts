import {
  afterEach, describe, expect, expectTypeOf, it, vi,
} from 'vitest'

const platformConstructorSpy = vi.fn()
const dataConstructorSpy = vi.fn()
const dashboardBackendConstructorSpy = vi.fn()
const metricsConstructorSpy = vi.fn()
const repositoriesConstructorSpy = vi.fn()
const repositoriesApiConstructorSpy = vi.fn()

vi.mock('@heroku/heroku-fetch', () => ({
  HerokuApiClient: class {
    constructor(options: unknown) {
      // The same constructor is used for every service; spies are
      // distinguished by the service field and custom-service base URL.
      const {baseUrl, service} = (options as {baseUrl?: string; service?: string})
      switch (service) {
        case 'data': {
          dataConstructorSpy(options)
          break
        }

        case 'particleboard': {
          dashboardBackendConstructorSpy(options)
          break
        }

        case 'platform': {
          if ((options as {defaultAccept?: string}).defaultAccept?.includes('repositories-api')) {
            repositoriesApiConstructorSpy(options)
          } else {
            platformConstructorSpy(options)
          }

          break
        }

        default: {
          if (service === 'custom' && baseUrl?.includes('metrics')) metricsConstructorSpy(options)
          if (service === 'custom' && baseUrl?.includes('kolkrabbi')) repositoriesConstructorSpy(options)
        }
      }
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

vi.mock('@heroku/types/dashboard-backend/routes', () => ({
  favorite: {
    list: {method: 'GET', path: '/favorites', query: ['type']},
  },
}))

vi.mock('@heroku/types/metrics/routes', () => ({
  formationMetric: {
    errors: {method: 'GET', path: '/apps/{app}/formation/{formationType}/metrics/errors', query: ['start_time']},
  },
  routerMetric: {
    latency: {method: 'GET', path: '/apps/{app}/router-metrics/latency', query: ['start_time']},
  },
}))

vi.mock('@heroku/types/repositories/routes', () => ({
  account: {
    infoWithToken: {method: 'GET', path: '/account/github/token'},
  },
}))

vi.mock('@heroku/types/repositories-api/routes', () => ({
  githubRepository: {
    info: {method: 'GET', path: '/pipelines/{pipelineIdentity}/repo'},
  },
}))

describe('HerokuSDK', () => {
  afterEach(() => {
    platformConstructorSpy.mockClear()
    dataConstructorSpy.mockClear()
    dashboardBackendConstructorSpy.mockClear()
    metricsConstructorSpy.mockClear()
    repositoriesConstructorSpy.mockClear()
    repositoriesApiConstructorSpy.mockClear()
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

  it('exposes the SDK\'s raw clients via ctx and constructs each lazily on first ctx access', async () => {
    const {HerokuSDK} = await import('./heroku-sdk.js')
    const {extendResource} = await import('./extend-resource.js')

    // A platform extension whose factory captures ctx.data, but doesn't call
    // it until the method is invoked. This pins down two invariants:
    //   1. Defining the extension does not eagerly build the data client.
    //   2. When the method is invoked, ctx.data is the raw client created by
    //      the SDK (constructed exactly once).
    const ext = extendResource('platform', 'app', ctx => ({
      peekData: () => ctx.data,
    }))

    const sdk = new HerokuSDK({extensions: [ext]})

    // Touching sdk.platform must not construct the data client.
    const platformView = sdk.platform
    expect(platformView).toBeDefined()
    expect(dataConstructorSpy).not.toHaveBeenCalled()

    // Now invoke the extension method, which reads ctx.data.
    const peeked = (sdk.platform.app as unknown as {peekData: () => unknown}).peekData()

    // Reading ctx.data triggers the raw data client construction exactly once.
    expect(dataConstructorSpy).toHaveBeenCalledTimes(1)
    // The data instance handed to the extension is the same one wrapped by sdk.data.
    // (sdk.data wraps the raw client in mergeExtensions, but with no data extensions
    // registered, the merged proxy still resolves through to the raw target.)
    expect(peeked).toBeDefined()
  })

  it('memoizes the data service client across repeated access', async () => {
    const {HerokuSDK} = await import('./heroku-sdk.js')
    const sdk = new HerokuSDK()

    const a = sdk.data
    const b = sdk.data

    expect(a).toBe(b)
    expect(dataConstructorSpy).toHaveBeenCalledTimes(1)
  })

  it('lazily constructs and memoizes the dashboard backend client', async () => {
    const {HerokuSDK} = await import('./heroku-sdk.js')
    const sdk = new HerokuSDK({clientOptions: {token: 'abc'}})

    expect(dashboardBackendConstructorSpy).not.toHaveBeenCalled()

    const a = sdk.dashboardBackend
    const b = sdk.dashboardBackend

    expect(a).toBe(b)
    expect(dashboardBackendConstructorSpy).toHaveBeenCalledTimes(1)
    expect(dashboardBackendConstructorSpy).toHaveBeenCalledWith(expect.objectContaining({
      service: 'particleboard',
      token: 'abc',
    }))
    expect(platformConstructorSpy).not.toHaveBeenCalled()
    expect(dataConstructorSpy).not.toHaveBeenCalled()
    expect(metricsConstructorSpy).not.toHaveBeenCalled()
    expect(repositoriesConstructorSpy).not.toHaveBeenCalled()
  })

  it('exposes one lazy raw dashboard backend client through extension context', async () => {
    const {HerokuSDK} = await import('./heroku-sdk.js')
    const {extendResource} = await import('./extend-resource.js')
    const ext = extendResource('platform', 'app', ctx => ({
      peekDashboardBackend: () => ctx.dashboardBackend,
    }))
    const sdk = new HerokuSDK({extensions: [ext]})

    const platformView = sdk.platform
    expect(platformView).toBeDefined()
    expect(dashboardBackendConstructorSpy).not.toHaveBeenCalled()

    const app = sdk.platform.app as unknown as {peekDashboardBackend: () => unknown}
    const first = app.peekDashboardBackend()
    const second = app.peekDashboardBackend()

    expect(first).toBe(second)
    expect(dashboardBackendConstructorSpy).toHaveBeenCalledTimes(1)

    const dashboardBackendView = sdk.dashboardBackend
    expect(dashboardBackendView).toBeDefined()
    expect(dashboardBackendConstructorSpy).toHaveBeenCalledTimes(1)
  })

  it('projects dashboard backend extensions onto only that service', async () => {
    const {HerokuSDK} = await import('./heroku-sdk.js')
    const {extendResource} = await import('./extend-resource.js')
    const ext = extendResource('dashboardBackend', 'favorite', () => ({
      marker: () => 'dashboard-backend' as const,
    }))
    const sdk = new HerokuSDK({extensions: [ext]})

    expectTypeOf(sdk.dashboardBackend.favorite.marker).returns.toEqualTypeOf<'dashboard-backend'>()
    expect(sdk.dashboardBackend.favorite.marker()).toBe('dashboard-backend')
    expect((sdk.platform as unknown as {favorite?: unknown}).favorite).toBeUndefined()
  })

  it('constructs no metrics client eagerly', async () => {
    const {HerokuSDK} = await import('./heroku-sdk.js')

    const sdk = new HerokuSDK()
    expect(sdk).toBeDefined()

    expect(metricsConstructorSpy).not.toHaveBeenCalled()
  })

  it('lazily constructs the metrics client on first access, passing clientOptions', async () => {
    const {HerokuSDK} = await import('./heroku-sdk.js')
    const sdk = new HerokuSDK({clientOptions: {token: 'abc'}})

    const _touch = sdk.metrics
    expect(_touch).toBeDefined()

    expect(metricsConstructorSpy).toHaveBeenCalledTimes(1)
    expect(metricsConstructorSpy).toHaveBeenCalledWith(expect.objectContaining({
      baseUrl: 'https://api.metrics.heroku.com',
      service: 'custom',
      token: 'abc',
    }))
    expect(platformConstructorSpy).not.toHaveBeenCalled()
    expect(dataConstructorSpy).not.toHaveBeenCalled()
  })

  it('memoizes the metrics service client across repeated access', async () => {
    const {HerokuSDK} = await import('./heroku-sdk.js')
    const sdk = new HerokuSDK()

    const a = sdk.metrics
    const b = sdk.metrics

    expect(a).toBe(b)
    expect(metricsConstructorSpy).toHaveBeenCalledTimes(1)
  })

  it('constructs no repositories client eagerly', async () => {
    const {HerokuSDK} = await import('./heroku-sdk.js')

    const sdk = new HerokuSDK()
    expect(sdk).toBeDefined()

    expect(repositoriesConstructorSpy).not.toHaveBeenCalled()
  })

  it('lazily constructs the repositories client on first access, passing clientOptions', async () => {
    const {HerokuSDK} = await import('./heroku-sdk.js')
    const sdk = new HerokuSDK({clientOptions: {token: 'abc'}})

    const _touch = sdk.repositories
    expect(_touch).toBeDefined()

    expect(repositoriesConstructorSpy).toHaveBeenCalledTimes(1)
    expect(repositoriesConstructorSpy).toHaveBeenCalledWith(expect.objectContaining({
      baseUrl: 'https://kolkrabbi.heroku.com',
      service: 'custom',
      token: 'abc',
    }))
    expect(platformConstructorSpy).not.toHaveBeenCalled()
    expect(dataConstructorSpy).not.toHaveBeenCalled()
  })

  it('memoizes the repositories service client across repeated access', async () => {
    const {HerokuSDK} = await import('./heroku-sdk.js')
    const sdk = new HerokuSDK()

    const a = sdk.repositories
    const b = sdk.repositories

    expect(a).toBe(b)
    expect(repositoriesConstructorSpy).toHaveBeenCalledTimes(1)
  })

  it('lazily constructs and memoizes the repositories API client', async () => {
    const {HerokuSDK} = await import('./heroku-sdk.js')
    const sdk = new HerokuSDK({clientOptions: {token: 'abc'}})

    expect(repositoriesApiConstructorSpy).not.toHaveBeenCalled()

    const a = sdk.repositoriesApi
    const b = sdk.repositoriesApi

    expect(a).toBe(b)
    expect(repositoriesApiConstructorSpy).toHaveBeenCalledTimes(1)
    expect(repositoriesApiConstructorSpy).toHaveBeenCalledWith(expect.objectContaining({
      service: 'platform',
      token: 'abc',
    }))
  })

  it('shallowly applies only the matching per-service options', async () => {
    const {HerokuSDK} = await import('./heroku-sdk.js')
    const sdk = new HerokuSDK({
      clientOptions: {
        headers: {'X-Common': 'common'},
        token: 'abc',
      },
      clientOptionsByService: {
        platform: {
          baseUrl: 'https://platform.example.test',
          headers: {'X-Platform': 'platform'},
        },
        repositoriesApi: {baseUrl: 'https://repositories-api.example.test'},
      },
    })

    const clients = [sdk.platform, sdk.repositoriesApi, sdk.repositories]
    expect(clients).toHaveLength(3)

    expect(platformConstructorSpy).toHaveBeenCalledWith(expect.objectContaining({
      baseUrl: 'https://platform.example.test',
      headers: {'X-Platform': 'platform'},
      token: 'abc',
    }))
    expect(repositoriesApiConstructorSpy).toHaveBeenCalledWith(expect.objectContaining({
      baseUrl: 'https://repositories-api.example.test',
      headers: {'X-Common': 'common'},
      token: 'abc',
    }))
    expect(repositoriesConstructorSpy).toHaveBeenCalledWith(expect.objectContaining({
      baseUrl: 'https://kolkrabbi.heroku.com',
      headers: {'X-Common': 'common'},
      token: 'abc',
    }))
  })

  it('applies each per-service option only to its matching client', async () => {
    const {HerokuSDK} = await import('./heroku-sdk.js')
    const sdk = new HerokuSDK({
      clientOptionsByService: {
        dashboardBackend: {timeout: 1},
        data: {timeout: 2},
        metrics: {timeout: 3},
        platform: {timeout: 4},
        repositories: {timeout: 5},
        repositoriesApi: {timeout: 6},
      },
    })

    const clients = [
      sdk.dashboardBackend,
      sdk.data,
      sdk.metrics,
      sdk.platform,
      sdk.repositories,
      sdk.repositoriesApi,
    ]
    expect(clients).toHaveLength(6)

    expect(dashboardBackendConstructorSpy).toHaveBeenCalledWith(expect.objectContaining({timeout: 1}))
    expect(dataConstructorSpy).toHaveBeenCalledWith(expect.objectContaining({timeout: 2}))
    expect(metricsConstructorSpy).toHaveBeenCalledWith(expect.objectContaining({timeout: 3}))
    expect(platformConstructorSpy).toHaveBeenCalledWith(expect.objectContaining({timeout: 4}))
    expect(repositoriesConstructorSpy).toHaveBeenCalledWith(expect.objectContaining({timeout: 5}))
    expect(repositoriesApiConstructorSpy).toHaveBeenCalledWith(expect.objectContaining({timeout: 6}))
  })
})
