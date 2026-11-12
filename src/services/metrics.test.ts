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
  afterEach(() => {
    vi.unstubAllEnvs()
    constructorSpy.mockClear()
  })

  it("uses heroku-fetch's 'metrics' service for the host and Accept default", async () => {
    const {createMetricsClient} = await import('./metrics.js')

    createMetricsClient({token: 'test-token'})

    expect(constructorSpy).toHaveBeenCalledExactlyOnceWith({service: 'metrics', token: 'test-token'})
  })

  it('leaves HEROKU_METRICS_HOST to heroku-fetch', async () => {
    vi.stubEnv('HEROKU_METRICS_HOST', 'https://api.metrics.herokai.com')
    const {createMetricsClient} = await import('./metrics.js')

    createMetricsClient({token: 'test-token'})

    expect(constructorSpy).toHaveBeenCalledExactlyOnceWith({service: 'metrics', token: 'test-token'})
  })

  it('lets caller-supplied baseUrl, service and headers win', async () => {
    const {createMetricsClient} = await import('./metrics.js')
    const headers = {Accept: 'application/vnd.heroku+json; version=4'}

    createMetricsClient({
      baseUrl: 'https://example.test', headers, service: 'platform', token: 't',
    })

    expect(constructorSpy).toHaveBeenCalledExactlyOnceWith({
      baseUrl: 'https://example.test', headers, service: 'platform', token: 't',
    })
  })
})
