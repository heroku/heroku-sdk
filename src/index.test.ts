import {describe, expect, it} from 'vitest'

import type {
  HerokuApiClientOptions,
  HerokuSDKOptions,
  ResourceCtx,
  ResourceExtension,
  ServiceName,
} from './index.js'

import {extendResource, HerokuSDK} from './index.js'

describe('@heroku/sdk bare entry', () => {
  it('exposes HerokuSDK as a constructor', () => {
    expect(typeof HerokuSDK).toBe('function')
    expect(new HerokuSDK()).toBeInstanceOf(HerokuSDK)
  })

  it('exposes extendResource as a callable', () => {
    expect(typeof extendResource).toBe('function')
    const ext = extendResource('platform', 'app', () => ({hello: () => 'world'}))
    expect(ext).toEqual({factory: expect.any(Function), resource: 'app', service: 'platform'})
  })

  it('keeps the public type surface intact', () => {
    const _options: HerokuSDKOptions<readonly ResourceExtension[]> = {}
    const _clientOptions: HerokuApiClientOptions = {}
    const _service: ServiceName = 'platform'
    const _ctx: Partial<ResourceCtx> = {}
    expect([_options, _clientOptions, _service, _ctx]).toBeDefined()
  })
})
