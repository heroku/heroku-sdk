import type {AddOnAttachment} from '@heroku/types/3.sdk'

import {
  describe, expect, it, vi,
} from 'vitest'

import type {ResourceCtx} from '../../core/extend-resource.js'

import {info, maintenanceExtensions, run, window} from './maintenance.js'

function buildCtx(opts: {
  maintenanceInfo?: ReturnType<typeof vi.fn>
  maintenanceRun?: ReturnType<typeof vi.fn>
  maintenanceWindow?: ReturnType<typeof vi.fn>
  resolution?: ReturnType<typeof vi.fn>
  resolutionByAttachment?: ReturnType<typeof vi.fn>
}): ResourceCtx {
  return {
    data: {
      maintenance: {
        info: opts.maintenanceInfo ?? vi.fn(),
        run: opts.maintenanceRun ?? vi.fn(),
        window: opts.maintenanceWindow ?? vi.fn(),
      },
    } as never,
    platform: {
      addOn: {resolution: opts.resolution ?? vi.fn()},
      addOnAttachment: {resolution: opts.resolutionByAttachment ?? vi.fn()},
    } as never,
  }
}

const oneAttachmentMatch = [
  {addon: {app: {id: 'app-uuid', name: 'app-1'}, id: 'addon-y', name: 'pg-attached'}} as AddOnAttachment,
]

describe('maintenance resource', () => {
  it('info resolves the addon and calls maintenance.info', async () => {
    const resolutionByAttachment = vi.fn().mockResolvedValue(oneAttachmentMatch)
    const maintenanceInfo = vi.fn().mockResolvedValue({state: 'scheduled'})
    const ctx = buildCtx({maintenanceInfo, resolutionByAttachment})

    const result = await info(ctx, 'app-1', 'DATABASE_URL')

    expect(maintenanceInfo).toHaveBeenCalledWith('addon-y')
    expect(result).toEqual({state: 'scheduled'})
  })

  it('window resolves the addon and calls maintenance.window', async () => {
    const resolutionByAttachment = vi.fn().mockResolvedValue(oneAttachmentMatch)
    const maintenanceWindow = vi.fn().mockResolvedValue({window: 'Tuesdays 14:30'})
    const ctx = buildCtx({maintenanceWindow, resolutionByAttachment})

    const result = await window(ctx, 'app-1', 'DATABASE_URL')

    expect(maintenanceWindow).toHaveBeenCalledWith('addon-y')
    expect(result).toEqual({window: 'Tuesdays 14:30'})
  })

  it('run resolves the addon and calls maintenance.run', async () => {
    const resolutionByAttachment = vi.fn().mockResolvedValue(oneAttachmentMatch)
    const maintenanceRun = vi.fn().mockResolvedValue({message: 'maintenance started'})
    const ctx = buildCtx({maintenanceRun, resolutionByAttachment})

    const result = await run(ctx, 'app-1', 'DATABASE_URL')

    expect(maintenanceRun).toHaveBeenCalledWith('addon-y')
    expect(result).toEqual({message: 'maintenance started'})
  })

  it('window throws if signal is aborted', async () => {
    const ctx = buildCtx({})
    const controller = new AbortController()
    controller.abort()

    await expect(window(ctx, 'app-1', undefined, {signal: controller.signal})).rejects.toThrow()
  })

  it('run throws if signal is aborted', async () => {
    const ctx = buildCtx({})
    const controller = new AbortController()
    controller.abort()

    await expect(run(ctx, 'app-1', undefined, {signal: controller.signal})).rejects.toThrow()
  })

  it('maintenanceExtensions declares service: data, resource: maintenance', () => {
    expect(maintenanceExtensions.service).toBe('data')
    expect(maintenanceExtensions.resource).toBe('maintenance')
  })

  it('maintenanceExtensions factory exposes info, window, and run', () => {
    const methods = maintenanceExtensions.factory(buildCtx({}))
    expect(typeof methods.info).toBe('function')
    expect(typeof methods.window).toBe('function')
    expect(typeof methods.run).toBe('function')
  })
})
