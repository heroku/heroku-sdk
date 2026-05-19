import type {App} from '@heroku/types/3.sdk'

import {
  describe, expect, it, vi,
} from 'vitest'

import type {ResourceCtx} from '../../core/extend-resource.js'

import {appExtensions, disableMaintenance, enableMaintenance} from './app.js'

function ctxWithAppUpdate(update: ReturnType<typeof vi.fn>): ResourceCtx {
  return {
    data: {} as never,
    platform: {app: {update}} as never,
  }
}

describe('appExtensions and named functions', () => {
  it('enableMaintenance calls platform.app.update with maintenance: true', async () => {
    const update = vi.fn().mockResolvedValue({maintenance: true, name: 'app-1'} as App)

    const result = await enableMaintenance(ctxWithAppUpdate(update), 'app-1')

    expect(update).toHaveBeenCalledWith('app-1', {maintenance: true})
    expect(result).toEqual({maintenance: true, name: 'app-1'})
  })

  it('enableMaintenance throws if the abort signal is already aborted', async () => {
    const update = vi.fn()
    const controller = new AbortController()
    controller.abort()

    await expect(enableMaintenance(ctxWithAppUpdate(update), 'app-1', {signal: controller.signal})).rejects.toThrow()
    expect(update).not.toHaveBeenCalled()
  })

  it('disableMaintenance calls platform.app.update with maintenance: false', async () => {
    const update = vi.fn().mockResolvedValue({maintenance: false, name: 'app-1'} as App)

    const result = await disableMaintenance(ctxWithAppUpdate(update), 'app-1')

    expect(update).toHaveBeenCalledWith('app-1', {maintenance: false})
    expect(result).toEqual({maintenance: false, name: 'app-1'})
  })

  it('appExtensions declares service: platform, resource: app', () => {
    expect(appExtensions.service).toBe('platform')
    expect(appExtensions.resource).toBe('app')
  })

  it('appExtensions factory returns enableMaintenance and disableMaintenance methods', () => {
    const update = vi.fn()
    const methods = appExtensions.factory(ctxWithAppUpdate(update))
    expect(typeof methods.enableMaintenance).toBe('function')
    expect(typeof methods.disableMaintenance).toBe('function')
  })

  it('appExtensions enableMaintenance delegates to the named function', async () => {
    const update = vi.fn().mockResolvedValue({} as App)
    const methods = appExtensions.factory(ctxWithAppUpdate(update))

    await methods.enableMaintenance('app-1')

    expect(update).toHaveBeenCalledWith('app-1', {maintenance: true})
  })
})
