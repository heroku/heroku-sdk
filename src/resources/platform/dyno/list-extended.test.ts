import {HerokuApiClient} from '@heroku/heroku-fetch'
import {
  beforeEach, describe, expect, it, vi,
} from 'vitest'

import {listExtended} from './list-extended.js'

vi.mock('@heroku/heroku-fetch', async () => {
  const actual = await vi.importActual<typeof import('@heroku/heroku-fetch')>('@heroku/heroku-fetch')
  return {
    ...actual,
    HerokuApiClient: vi.fn(),
  }
})

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    headers: {'content-type': 'application/json'},
    status,
  })
}

function mockGet(get: ReturnType<typeof vi.fn>) {
  vi.mocked(HerokuApiClient).mockImplementation(function (this: {get: typeof get}) {
    this.get = get
  } as never)
}

describe('listExtended', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('GETs the extended dynos endpoint with the version=3.sdk Accept and returns the parsed body', async () => {
    const dynos = [{extended: {region: 'us'}, name: 'web.1', state: 'up'}]
    const get = vi.fn().mockResolvedValue(jsonResponse(dynos))
    mockGet(get)

    const result = await listExtended('app-1')

    expect(HerokuApiClient).toHaveBeenCalledWith({service: 'platform'})
    expect(get).toHaveBeenCalledWith(
      '/apps/app-1/dynos?extended=true',
      {headers: {Accept: 'application/vnd.heroku+json; version=3.sdk'}, signal: undefined},
    )
    expect(result).toEqual(dynos)
  })

  it('encodes the app identity in the path', async () => {
    const get = vi.fn().mockResolvedValue(jsonResponse([]))
    mockGet(get)

    await listExtended('my app/1')

    expect(get).toHaveBeenCalledWith(
      '/apps/my%20app%2F1/dynos?extended=true',
      expect.anything(),
    )
  })

  it('forwards clientOptions into the raw client and the signal into the request', async () => {
    const get = vi.fn().mockResolvedValue(jsonResponse([]))
    mockGet(get)
    const controller = new AbortController()

    await listExtended('app-1', {clientOptions: {service: 'platform'}, signal: controller.signal})

    expect(HerokuApiClient).toHaveBeenCalledWith({service: 'platform'})
    expect(get).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({signal: controller.signal}))
  })

  it('throws immediately when the signal is already aborted', async () => {
    const get = vi.fn()
    mockGet(get)
    const controller = new AbortController()
    controller.abort()

    await expect(listExtended('app-1', {signal: controller.signal})).rejects.toThrow()
    expect(HerokuApiClient).not.toHaveBeenCalled()
    expect(get).not.toHaveBeenCalled()
  })
})
