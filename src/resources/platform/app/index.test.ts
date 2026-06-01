import type {App} from '@heroku/types/3.sdk'

import {
  describe, expect, it, vi,
} from 'vitest'

import type {ResourceCtx} from '../../../core/extend-resource.js'

import {
  appExtensions, disableMaintenance, enableMaintenance, getGeneration, getProcessTier, isShielded,
} from './index.js'

function ctxWithAppUpdate(update: ReturnType<typeof vi.fn>): ResourceCtx {
  return {
    data: {} as never,
    platform: {app: {update}} as never,
  }
}

function ctxWithAppInfo(info: ReturnType<typeof vi.fn>): {
  ctx: ResourceCtx
  withHeaders: ReturnType<typeof vi.fn>
} {
  const platform = {
    app: {info},
    withHeaders: vi.fn(),
  }
  platform.withHeaders.mockReturnValue(platform)
  return {
    ctx: {data: {} as never, platform: platform as never},
    withHeaders: platform.withHeaders,
  }
}

function ctxWithDirectAppInfo(info: ReturnType<typeof vi.fn>): ResourceCtx {
  const platform: Record<string, unknown> = {app: {info}}
  platform.withOptions = vi.fn().mockReturnValue(platform)
  return {data: {} as never, platform: platform as never}
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

  describe('getGeneration', () => {
    it('returns "cedar" when the app reports generation: cedar', async () => {
      const info = vi.fn().mockResolvedValue({generation: 'cedar'})
      const {ctx, withHeaders} = ctxWithAppInfo(info)

      const result = await getGeneration(ctx, 'my-app')

      expect(withHeaders).toHaveBeenCalledWith({Accept: 'application/vnd.heroku+json; version=3.sdk'})
      expect(info).toHaveBeenCalledExactlyOnceWith('my-app')
      expect(result).toBe('cedar')
    })

    it('returns "fir" when the app reports generation: fir', async () => {
      const info = vi.fn().mockResolvedValue({generation: 'fir'})
      const {ctx} = ctxWithAppInfo(info)

      expect(await getGeneration(ctx, 'my-app')).toBe('fir')
    })

    it('returns undefined for an unrecognized generation string', async () => {
      const info = vi.fn().mockResolvedValue({generation: 'something-else'})
      const {ctx} = ctxWithAppInfo(info)

      expect(await getGeneration(ctx, 'my-app')).toBeUndefined()
    })

    it('returns undefined when the app has no generation field', async () => {
      const info = vi.fn().mockResolvedValue({})
      const {ctx} = ctxWithAppInfo(info)

      expect(await getGeneration(ctx, 'my-app')).toBeUndefined()
    })

    it('throws if the abort signal is already aborted', async () => {
      const info = vi.fn()
      const {ctx} = ctxWithAppInfo(info)
      const controller = new AbortController()
      controller.abort()

      await expect(getGeneration(ctx, 'my-app', {signal: controller.signal})).rejects.toThrow()
      expect(info).not.toHaveBeenCalled()
    })

    it('exposed on appExtensions.factory', () => {
      const info = vi.fn()
      const {ctx} = ctxWithAppInfo(info)
      const methods = appExtensions.factory(ctx)
      expect(typeof methods.getGeneration).toBe('function')
    })
  })

  describe('isShielded', () => {
    it('returns true when app is in a shielded space', async () => {
      const info = vi.fn().mockResolvedValue({space: {shield: true}})
      const ctx = ctxWithDirectAppInfo(info)

      expect(await isShielded(ctx, 'my-app')).toBe(true)
      expect(info).toHaveBeenCalledWith('my-app')
    })

    it('returns false when app space is not shielded', async () => {
      const info = vi.fn().mockResolvedValue({space: {shield: false}})
      const ctx = ctxWithDirectAppInfo(info)

      expect(await isShielded(ctx, 'my-app')).toBe(false)
    })

    it('returns false when app has no space', async () => {
      const info = vi.fn().mockResolvedValue({})
      const ctx = ctxWithDirectAppInfo(info)

      expect(await isShielded(ctx, 'my-app')).toBe(false)
    })

    it('throws if the abort signal is already aborted', async () => {
      const info = vi.fn()
      const ctx = ctxWithDirectAppInfo(info)
      const controller = new AbortController()
      controller.abort()

      await expect(isShielded(ctx, 'my-app', {signal: controller.signal})).rejects.toThrow()
      expect(info).not.toHaveBeenCalled()
    })

    it('exposed on appExtensions.factory', () => {
      const info = vi.fn()
      const ctx = ctxWithDirectAppInfo(info)
      const methods = appExtensions.factory(ctx)
      expect(typeof methods.isShielded).toBe('function')
    })
  })

  describe('getProcessTier', () => {
    it('returns the process tier when present', async () => {
      // eslint-disable-next-line camelcase
      const info = vi.fn().mockResolvedValue({process_tier: 'eco'})
      const ctx = ctxWithDirectAppInfo(info)

      expect(await getProcessTier(ctx, 'my-app')).toBe('eco')
      expect(info).toHaveBeenCalledWith('my-app')
    })

    it('returns undefined when process_tier is not present', async () => {
      const info = vi.fn().mockResolvedValue({})
      const ctx = ctxWithDirectAppInfo(info)

      expect(await getProcessTier(ctx, 'my-app')).toBeUndefined()
    })

    it('throws if the abort signal is already aborted', async () => {
      const info = vi.fn()
      const ctx = ctxWithDirectAppInfo(info)
      const controller = new AbortController()
      controller.abort()

      await expect(getProcessTier(ctx, 'my-app', {signal: controller.signal})).rejects.toThrow()
      expect(info).not.toHaveBeenCalled()
    })

    it('exposed on appExtensions.factory', () => {
      const info = vi.fn()
      const ctx = ctxWithDirectAppInfo(info)
      const methods = appExtensions.factory(ctx)
      expect(typeof methods.getProcessTier).toBe('function')
    })
  })
})
