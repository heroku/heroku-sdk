import {
  afterEach, describe, expect, it, vi,
} from 'vitest'

// Records every HerokuApiClient construction and hands back an instance whose
// `get` resolves an empty JSON array, so a real extension can run end-to-end
// over a stubbed transport without touching the network.
const constructorSpy = vi.fn()

vi.mock('@heroku/heroku-fetch', () => ({
  HerokuApiClient: class {
    get = vi.fn().mockResolvedValue(new Response('[]', {headers: {'content-type': 'application/json'}}))

    constructor(options: unknown) {
      constructorSpy(options)
    }
  },
}))

describe('HerokuSDK end-to-end client threading', () => {
  afterEach(() => {
    constructorSpy.mockClear()
    vi.resetModules()
  })

  it('threads the SDK userAgent and signal all the way to a real extension\'s client', async () => {
    const {HerokuSDK} = await import('./heroku-sdk.js')
    const {dynoExtensions} = await import('../resources/platform/dyno/index.js')
    const {SDK_VERSION} = await import('../version.js')

    const {signal} = new AbortController()
    const sdk = new HerokuSDK({
      clientOptions: {signal, token: 'abc'},
      extensions: [dynoExtensions],
    })

    const dynos = await sdk.platform.dyno.listExtended('app-1')
    expect(dynos).toEqual([])

    // The bare `extended=true` GET is issued by a client the extension built
    // through ctx.makeClient. It must carry the SDK's identity + signal,
    // proving the chain SDK → extension → makeCtxClient → HerokuApiClient keeps
    // the resolved options intact.
    expect(constructorSpy).toHaveBeenLastCalledWith(expect.objectContaining({
      service: 'platform',
      signal,
      userAgent: {name: '@heroku/sdk', version: SDK_VERSION},
    }))
  })
})
