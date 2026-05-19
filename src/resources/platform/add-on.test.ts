import type {AddOn} from '@heroku/types/3.sdk'

import {
  describe, expect, it, vi,
} from 'vitest'

import type {ResourceCtx} from '../../core/extend-resource.js'

import {addOnExtensions, upgrade} from './add-on.js'

function ctxWithAddOnUpdate(update: ReturnType<typeof vi.fn>): ResourceCtx {
  return {
    data: {} as never,
    platform: {addOn: {update}} as never,
  }
}

describe('addOnExtensions and named functions', () => {
  it('upgrade calls platform.addOn.update with the plan', async () => {
    const addOn = {name: 'heroku-postgresql', plan: {name: 'premium-0'}} as AddOn
    const update = vi.fn().mockResolvedValue(addOn)

    const result = await upgrade(ctxWithAddOnUpdate(update), 'my-app', 'heroku-postgresql', 'heroku-postgresql:premium-0')

    expect(update).toHaveBeenCalledWith('my-app', 'heroku-postgresql', {plan: 'heroku-postgresql:premium-0'})
    expect(result).toBe(addOn)
  })

  it('upgrade throws if the abort signal is already aborted', async () => {
    const update = vi.fn()
    const controller = new AbortController()
    controller.abort()

    await expect(
      upgrade(ctxWithAddOnUpdate(update), 'my-app', 'addon-1', 'plan-1', {signal: controller.signal}),
    ).rejects.toThrow()
    expect(update).not.toHaveBeenCalled()
  })

  it('addOnExtensions declares service: platform, resource: addOn', () => {
    expect(addOnExtensions.service).toBe('platform')
    expect(addOnExtensions.resource).toBe('addOn')
  })

  it('addOnExtensions factory returns an upgrade method', () => {
    const update = vi.fn()
    const methods = addOnExtensions.factory(ctxWithAddOnUpdate(update))
    expect(typeof methods.upgrade).toBe('function')
  })

  it('addOnExtensions upgrade delegates to the named function', async () => {
    const update = vi.fn().mockResolvedValue({} as AddOn)
    const methods = addOnExtensions.factory(ctxWithAddOnUpdate(update))

    await methods.upgrade('my-app', 'heroku-postgresql', 'heroku-postgresql:premium-0')

    expect(update).toHaveBeenCalledWith('my-app', 'heroku-postgresql', {plan: 'heroku-postgresql:premium-0'})
  })
})
