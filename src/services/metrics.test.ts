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

vi.mock('@heroku/types/metrics/routes', () => ({
  formationMetric: {
    errors: {method: 'GET', path: '/apps/{app}/formation/{formationType}/metrics/errors', query: ['start_time']},
  },
  routerMetric: {
    latency: {method: 'GET', path: '/apps/{app}/router-metrics/latency', query: ['start_time']},
  },
}))

describe('createMetricsClient', () => {
  const OLD_ENV = process.env.HEROKU_METRICS_HOST
  afterEach(() => {
    if (OLD_ENV === undefined) delete process.env.HEROKU_METRICS_HOST
    else process.env.HEROKU_METRICS_HOST = OLD_ENV
    constructorSpy.mockClear()
  })

  it("defaults to service 'custom' and the metrics base URL", async () => {
    delete process.env.HEROKU_METRICS_HOST
    constructorSpy.mockClear()
    const {createMetricsClient} = await import('./metrics.js')

    createMetricsClient({token: 'test-token'})

    expect(constructorSpy).toHaveBeenCalledWith(expect.objectContaining({
      baseUrl: 'https://api.metrics.heroku.com',
      service: 'custom',
      token: 'test-token',
    }))
  })

  it('forwards the versioned Accept header by default', async () => {
    delete process.env.HEROKU_METRICS_HOST
    constructorSpy.mockClear()
    const {createMetricsClient} = await import('./metrics.js')

    createMetricsClient({token: 'test-token'})

    expect(constructorSpy).toHaveBeenCalledWith(expect.objectContaining({
      headers: expect.objectContaining({Accept: 'application/vnd.heroku+json; version=3'}),
    }))
  })

  it('lets a caller override the Accept header', async () => {
    delete process.env.HEROKU_METRICS_HOST
    constructorSpy.mockClear()
    const {createMetricsClient} = await import('./metrics.js')

    createMetricsClient({headers: {Accept: 'application/vnd.heroku+json; version=4'}, token: 't'})

    expect(constructorSpy).toHaveBeenCalledWith(expect.objectContaining({
      headers: expect.objectContaining({Accept: 'application/vnd.heroku+json; version=4'}),
    }))
  })

  it('honors HEROKU_METRICS_HOST as a base-URL override', async () => {
    process.env.HEROKU_METRICS_HOST = 'https://api.metrics.herokai.com'
    constructorSpy.mockClear()
    vi.resetModules()
    const {createMetricsClient} = await import('./metrics.js')

    createMetricsClient({token: 'test-token'})

    expect(constructorSpy).toHaveBeenCalledWith(expect.objectContaining({
      baseUrl: 'https://api.metrics.herokai.com',
    }))
  })

  it('lets caller-supplied baseUrl/service override the defaults', async () => {
    constructorSpy.mockClear()
    vi.resetModules()
    const {createMetricsClient} = await import('./metrics.js')

    createMetricsClient({baseUrl: 'https://example.test', service: 'platform', token: 't'})

    expect(constructorSpy).toHaveBeenCalledWith(expect.objectContaining({
      baseUrl: 'https://example.test',
      service: 'platform',
    }))
  })
})
