import {HerokuApiClient} from '@heroku/heroku-fetch'
import {
  describe, expect, expectTypeOf, it, vi,
} from 'vitest'

import {extendResource, makeCtxClient} from './extend-resource.js'

const clientConstructorSpy = vi.fn()

// vitest hoists vi.mock above the imports above, so HerokuApiClient here (and
// the one extend-resource.ts builds in the makeClient-absent fallback) is this
// constructor-recording stand-in.
vi.mock('@heroku/heroku-fetch', () => ({
  HerokuApiClient: class {
    constructor(options: unknown) {
      clientConstructorSpy(options)
    }
  },
}))

const descriptorFactory = () => ({foo: () => 'bar'})

describe('extendResource', () => {
  it('returns a descriptor with service, resource, and factory fields', () => {
    const ext = extendResource('platform', 'app', descriptorFactory)

    expect(ext.service).toBe('platform')
    expect(ext.resource).toBe('app')
    expect(ext.factory).toBe(descriptorFactory)
  })

  it('factory is invoked with the supplied ctx and returns the methods record', () => {
    const ctx = {data: {marker: 'd'} as never, platform: {marker: 'p'} as never}
    const ext = extendResource('data', 'database', received => ({
      identify: () => received,
    }))

    const methods = ext.factory(ctx)
    expect(methods.identify()).toBe(ctx)
  })

  it('preserves literal generics on the returned descriptor', () => {
    const ext = extendResource('platform', 'app', () => ({foo: () => 1 as const}))
    expectTypeOf(ext.service).toEqualTypeOf<'platform'>()
    expectTypeOf(ext.resource).toEqualTypeOf<'app'>()
    expectTypeOf(ext.factory).returns.toEqualTypeOf<{foo: () => 1}>()
  })
})

describe('makeCtxClient', () => {
  it('delegates to ctx.makeClient with the service and overrides when present', () => {
    const sentinel = {} as HerokuApiClient
    const makeClient = vi.fn().mockReturnValue(sentinel)
    const overrides = {baseUrl: 'https://stream.example.com', service: 'custom' as const, token: ''}

    const client = makeCtxClient({makeClient}, 'platform', overrides)

    expect(client).toBe(sentinel)
    expect(makeClient).toHaveBeenCalledWith('platform', overrides)
  })

  it('falls back to a bare HerokuApiClient carrying only the overrides when makeClient is absent', () => {
    clientConstructorSpy.mockClear()
    const overrides = {
      baseUrl: 'https://stream.example.com',
      service: 'custom' as const,
      token: '',
    }

    const client = makeCtxClient({}, 'platform', overrides)

    expect(client).toBeInstanceOf(HerokuApiClient)
    // The overrides — notably service: 'custom' and the empty token — are what
    // keep the Heroku token off third-party stream hosts, so assert they reach
    // the constructor rather than just that *some* client was built.
    expect(clientConstructorSpy).toHaveBeenCalledWith(overrides)
  })
})
