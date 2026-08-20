/* eslint-disable camelcase */
import {
  afterEach, describe, expect, it, vi,
} from 'vitest'

const deleteSpy = vi.fn()
const getSpy = vi.fn()
const postSpy = vi.fn()

vi.mock('@heroku/heroku-fetch', () => ({
  HerokuApiClient: class {
    delete = deleteSpy
    get = getSpy
    post = postSpy
  },
}))

function jsonResponse(body: unknown, status = 200) {
  return {
    headers: {get: (name: string) => name === 'content-length' ? JSON.stringify(body).length.toString() : null},
    json: () => Promise.resolve(body),
    status,
  }
}

function noContentResponse() {
  return {
    headers: {get: () => null},
    status: 204,
  }
}

describe('dashboard backend end-to-end dispatch', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  it('lists favorites with the declared type query', async () => {
    const favorites = [{
      id: 'favorite-1', resource_id: 'app-1', resource_name: 'my-app', type: 'app',
    }]
    getSpy.mockResolvedValue(jsonResponse(favorites))
    const {createDashboardBackendClient} = await import('./dashboard-backend.js')
    const client = createDashboardBackendClient({token: 'test-token'})

    const result = await client.favorite.list({type: 'app'})

    expect(getSpy).toHaveBeenCalledWith('/favorites', {searchParams: {type: 'app'}})
    expect(result).toEqual(favorites)
  })

  it('creates a favorite with the unwrapped request body', async () => {
    const request = {resource_id: 'app-1', type: 'app'}
    const favorite = {id: 'favorite-1', ...request}
    postSpy.mockResolvedValue(jsonResponse(favorite, 201))
    const {createDashboardBackendClient} = await import('./dashboard-backend.js')
    const client = createDashboardBackendClient({token: 'test-token'})

    const result = await client.favorite.create(request)

    expect(postSpy).toHaveBeenCalledWith('/favorites', request)
    expect(result).toEqual(favorite)
  })

  it('returns undefined when duplicate favorite creation has no content', async () => {
    postSpy.mockResolvedValue(noContentResponse())
    const {createDashboardBackendClient} = await import('./dashboard-backend.js')
    const client = createDashboardBackendClient({token: 'test-token'})

    const result = await client.favorite.create({resource_id: 'app-1', type: 'app'})

    expect(result).toBeUndefined()
  })

  it('URL-encodes the favorite ID and returns undefined after deletion', async () => {
    deleteSpy.mockResolvedValue(noContentResponse())
    const {createDashboardBackendClient} = await import('./dashboard-backend.js')
    const client = createDashboardBackendClient({token: 'test-token'})

    const result = await client.favorite.delete('favorite/1')

    expect(deleteSpy).toHaveBeenCalledWith('/favorites/favorite%2F1')
    expect(result).toBeUndefined()
  })
})
