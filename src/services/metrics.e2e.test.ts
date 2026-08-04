import {
  describe, expect, it, vi,
} from 'vitest'

const getSpy = vi.fn()

vi.mock('@heroku/heroku-fetch', () => ({
  HerokuApiClient: class {
    get = getSpy
  },
}))

function jsonResponse(body: unknown) {
  return {
    headers: new Headers({'content-length': JSON.stringify(body).length.toString()}),
    json: () => Promise.resolve(body),
    status: 200,
  }
}

// Real metrics routes (post Jon Step 1). If running before install, swap to a
// local vi.mock('@heroku/types/metrics/routes', ...) mirroring the real shape.
describe('metrics end-to-end dispatch', () => {
  it('routerMetric.latency issues GET with interpolated path + searchParams', async () => {
    getSpy.mockResolvedValue(jsonResponse({
      data: {}, end_time: 'b', start_time: 'a', step: '1h',
    }))
    const {createMetricsClient} = await import('./metrics.js')
    const client = createMetricsClient({token: 't'})

    const result = await client.routerMetric.latency('my-app', {
      end_time: 'b', process_type: 'web', start_time: 'a', step: '1h',
    })

    expect(getSpy).toHaveBeenCalledWith('/apps/my-app/router-metrics/latency', {
      searchParams: {
        end_time: 'b', process_type: 'web', start_time: 'a', step: '1h',
      },
    })
    expect(result).toEqual({
      data: {}, end_time: 'b', start_time: 'a', step: '1h',
    })
  })

  it('formationMetric.errors interpolates app + formationType path params', async () => {
    getSpy.mockResolvedValue(jsonResponse({
      data: {}, end_time: 'b', start_time: 'a', step: '1h',
    }))
    const {createMetricsClient} = await import('./metrics.js')
    const client = createMetricsClient({token: 't'})

    await client.formationMetric.errors('my-app', 'web', {end_time: 'b', start_time: 'a', step: '1h'})

    expect(getSpy).toHaveBeenCalledWith('/apps/my-app/formation/web/metrics/errors', {
      searchParams: {end_time: 'b', start_time: 'a', step: '1h'},
    })
  })

  it('drops query keys not declared on the route', async () => {
    getSpy.mockResolvedValue(jsonResponse({
      data: {}, end_time: 'b', start_time: 'a', step: '1h',
    }))
    const {createMetricsClient} = await import('./metrics.js')
    const client = createMetricsClient({token: 't'})

    await client.routerMetric.latency('my-app', {
      bogus_key: 'nope', end_time: 'b', start_time: 'a', step: '1h',
    } as never)

    expect(getSpy).toHaveBeenCalledWith('/apps/my-app/router-metrics/latency', {
      searchParams: {end_time: 'b', start_time: 'a', step: '1h'},
    })
  })
})
