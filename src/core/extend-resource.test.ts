import {
  describe, expect, expectTypeOf, it,
} from 'vitest'

import {extendResource} from './extend-resource.js'

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
