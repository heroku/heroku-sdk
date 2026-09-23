import {
  afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest'

// Capture the HTTP calls the generic metrics client makes so we can prove the
// `formationMonitor.*` methods resolve off the 6a routes and dispatch correctly.
const calls: {method: string; path: string; body?: unknown}[] = []

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    headers: {'content-type': 'application/json'},
    status,
  })
}

vi.mock('@heroku/heroku-fetch', () => ({
  HerokuApiClient: class {
    constructor(_options: unknown) {}

    get(path: string) {
      calls.push({method: 'GET', path})
      return Promise.resolve(jsonResponse([{action_type: 'scale', id: 'mon-1'}]))
    }

    patch(path: string, body: unknown) {
      calls.push({body, method: 'PATCH', path})
      return Promise.resolve(jsonResponse({action_type: 'scale', id: 'mon-1', is_active: false}))
    }

    post(path: string, body: unknown) {
      calls.push({body, method: 'POST', path})
      return Promise.resolve(jsonResponse({action_type: 'scale', id: 'mon-2'}, 201))
    }
  },
}))

vi.mock('@heroku/types/metrics/routes', () => ({
  formationMonitor: {
    create: {hasRequestBody: true, method: 'POST', path: '/apps/{app}/formation/{formationType}/monitors'},
    list: {method: 'GET', path: '/apps/{app}/formation/{formationType}/monitors'},
    update: {hasRequestBody: true, method: 'PATCH', path: '/apps/{app}/formation/{formationType}/monitors/{monitorId}'},
  },
}))

describe('metrics formationMonitor resource', () => {
  beforeEach(() => {
    calls.length = 0
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('lists monitors via GET on the formation monitors path', async () => {
    const {createMetricsClient} = await import('./metrics.js')
    const client = createMetricsClient({token: 't'}) as any

    const monitors = await client.formationMonitor.list('app-1', 'web')

    expect(calls).toEqual([{method: 'GET', path: '/apps/app-1/formation/web/monitors'}])
    expect(monitors).toEqual([{action_type: 'scale', id: 'mon-1'}])
  })

  it('creates a monitor via POST with the request body', async () => {
    const {createMetricsClient} = await import('./metrics.js')
    const client = createMetricsClient({token: 't'}) as any
    const body = {action_type: 'scale', is_active: true, max_quantity: 10, min_quantity: 1}

    const created = await client.formationMonitor.create('app-1', 'web', body)

    expect(calls).toEqual([{body, method: 'POST', path: '/apps/app-1/formation/web/monitors'}])
    expect(created).toEqual({action_type: 'scale', id: 'mon-2'})
  })

  it('updates a monitor via PATCH keyed by monitor id', async () => {
    const {createMetricsClient} = await import('./metrics.js')
    const client = createMetricsClient({token: 't'}) as any
    const body = {is_active: false, op: 'GREATER_OR_EQUAL', period: 1}

    const updated = await client.formationMonitor.update('app-1', 'web', 'mon-1', body)

    expect(calls).toEqual([{body, method: 'PATCH', path: '/apps/app-1/formation/web/monitors/mon-1'}])
    expect(updated).toEqual({action_type: 'scale', id: 'mon-1', is_active: false})
  })
})
