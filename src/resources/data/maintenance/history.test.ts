import {
  describe, expect, it, vi,
} from 'vitest'

import type {ResourceCtx} from '../../../core/extend-resource.js'

import {history} from './history.js'

function buildCtx(opts: {
  maintenanceHistory?: ReturnType<typeof vi.fn>
  resolution?: ReturnType<typeof vi.fn>
}): Pick<ResourceCtx, 'data' | 'platform'> {
  const dataClient = {
    maintenance: {
      history: opts.maintenanceHistory ?? vi.fn(),
    },
    withOptions: vi.fn(() => dataClient),
  }

  return {
    data: dataClient as never,
    platform: {
      addOn: {
        resolution: opts.resolution ?? vi.fn(),
      },
      withHeaders() {
        return this
      },
      withOptions() {
        return this
      },
    } as never,
  }
}

function buildAddon() {
  return {
    // eslint-disable-next-line camelcase
    addon_service: {name: 'heroku-postgresql'},
    app: {id: 'app-uuid', name: 'app-1'},
    id: 'addon-1',
    name: 'postgres-curved-12345',
    plan: {name: 'heroku-postgresql:standard-0'},
  }
}

describe('maintenance history', () => {
  it('resolves the addon and calls maintenance.history', async () => {
    const addonMock = buildAddon()
    const resolution = vi.fn().mockResolvedValue([addonMock])
    const maintenanceHistory = vi.fn().mockResolvedValue({maintenances: []})
    const ctx = buildCtx({maintenanceHistory, resolution})

    const result = await history(ctx, 'postgres-curved-12345', {limit: 10})

    expect(maintenanceHistory).toHaveBeenCalledWith('addon-1', {limit: 10})
    expect(result.history).toEqual({maintenances: []})
    expect(result.addon).toEqual(addonMock)
  })

  it('scopes resolution by appIdentity when given', async () => {
    const resolution = vi.fn().mockResolvedValue([buildAddon()])
    const ctx = buildCtx({
      maintenanceHistory: vi.fn().mockResolvedValue({maintenances: []}),
      resolution,
    })

    await history(ctx, 'DATABASE_URL', {}, {appIdentity: 'app-1'})

    expect(resolution).toHaveBeenCalledWith({addon: 'DATABASE_URL', app: 'app-1'})
  })

  it('binds the signal to the data client so the request aborts in flight', async () => {
    const ctx = buildCtx({
      maintenanceHistory: vi.fn().mockResolvedValue({maintenances: []}),
      resolution: vi.fn().mockResolvedValue([buildAddon()]),
    })
    const controller = new AbortController()

    await history(ctx, 'postgres-curved-12345', {}, {signal: controller.signal})

    expect(ctx.data.withOptions).toHaveBeenCalledWith({signal: controller.signal})
  })

  it('throws if signal is aborted', async () => {
    const ctx = buildCtx({})
    const controller = new AbortController()
    controller.abort()

    await expect(history(ctx, 'postgres-curved-12345', {}, {signal: controller.signal})).rejects.toThrow()
  })

  it('fires beforeHistory with the resolved addon before calling maintenance.history', async () => {
    const maintenanceHistory = vi.fn().mockResolvedValue({maintenances: []})
    const addonMock = buildAddon()
    const ctx = buildCtx({
      maintenanceHistory,
      resolution: vi.fn().mockResolvedValue([addonMock]),
    })
    const beforeHistory = vi.fn()

    await history(ctx, 'postgres-curved-12345', {}, {beforeHistory})

    expect(beforeHistory).toHaveBeenCalledWith({addon: addonMock})
    expect(beforeHistory).toHaveBeenCalledBefore(maintenanceHistory)
  })

  it('throws before calling maintenance.history when beforeHistory throws', async () => {
    const maintenanceHistory = vi.fn().mockResolvedValue({maintenances: []})
    const ctx = buildCtx({
      maintenanceHistory,
      resolution: vi.fn().mockResolvedValue([buildAddon()]),
    })
    const beforeHistory = vi.fn().mockRejectedValue(new Error('declined'))

    await expect(history(ctx, 'postgres-curved-12345', {}, {beforeHistory})).rejects.toThrow('declined')
    expect(maintenanceHistory).not.toHaveBeenCalled()
  })

  it('throws after beforeHistory if the signal is aborted', async () => {
    const maintenanceHistory = vi.fn().mockResolvedValue({maintenances: []})
    const controller = new AbortController()
    const ctx = buildCtx({
      maintenanceHistory,
      resolution: vi.fn().mockResolvedValue([buildAddon()]),
    })
    const beforeHistory = vi.fn(() => controller.abort())

    await expect(history(ctx, 'postgres-curved-12345', {}, {beforeHistory, signal: controller.signal}))
      .rejects.toThrow()
    expect(maintenanceHistory).not.toHaveBeenCalled()
  })
})
