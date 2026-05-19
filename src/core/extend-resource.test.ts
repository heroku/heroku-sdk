import {describe, expect, it} from 'vitest'

import {extendResource} from './extend-resource.js'

describe('extendResource', () => {
  it('returns a descriptor with service, resource, and factory fields', () => {
    const factory = () => ({foo: () => 'bar'})
    const ext = extendResource('platform', 'app', factory)

    expect(ext.service).toBe('platform')
    expect(ext.resource).toBe('app')
    expect(ext.factory).toBe(factory)
  })

  it('factory is invoked with the supplied ctx and returns the methods record', () => {
    const ctx = {platform: {marker: 'p'} as any, data: {marker: 'd'} as any}
    const ext = extendResource('data', 'database', (received) => ({
      identify: () => received,
    }))

    const methods = ext.factory(ctx)
    expect(methods.identify()).toBe(ctx)
  })
})
