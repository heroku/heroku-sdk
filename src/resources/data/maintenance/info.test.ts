import {
  describe, expect, it, vi,
} from 'vitest'

import type {ResourceCtx} from '../../../core/extend-resource.js'

import {info} from './info.js'

function buildCtx(opts: {
  maintenanceInfo?: ReturnType<typeof vi.fn>
  resolution?: ReturnType<typeof vi.fn>
}): Pick<ResourceCtx, 'data' | 'platform'> {
  const dataClient = {
    maintenance: {
      info: opts.maintenanceInfo ?? vi.fn(),
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
    name: 'pg-addon',
    plan: {name: 'heroku-postgresql:standard-0'},
  }
}

describe('maintenance info', () => {
  it('resolves the addon and calls maintenance.info', async () => {
    const addonMock = buildAddon()
    const resolution = vi.fn().mockResolvedValue([addonMock])
    const maintenanceInfo = vi.fn().mockResolvedValue({status: 'none'})
    const ctx = buildCtx({maintenanceInfo, resolution})

    const {addon, maintenance} = await info(ctx, 'postgres-curved-12345')

    expect(maintenanceInfo).toHaveBeenCalledWith('addon-1')
    expect(maintenance).toEqual({status: 'none'})
    expect(addon).toEqual(addonMock)
  })

  it('scopes resolution by appIdentity when given', async () => {
    const resolution = vi.fn().mockResolvedValue([buildAddon()])
    const ctx = buildCtx({
      maintenanceInfo: vi.fn().mockResolvedValue({status: 'none'}),
      resolution,
    })

    await info(ctx, 'DATABASE_URL', {appIdentity: 'app-1'})

    expect(resolution).toHaveBeenCalledWith({addon: 'DATABASE_URL', app: 'app-1'})
  })

  it('binds the signal to the data client so the request aborts in flight', async () => {
    const ctx = buildCtx({
      maintenanceInfo: vi.fn().mockResolvedValue({status: 'none'}),
      resolution: vi.fn().mockResolvedValue([buildAddon()]),
    })
    const controller = new AbortController()

    await info(ctx, 'postgres-curved-12345', {signal: controller.signal})

    expect(ctx.data.withOptions).toHaveBeenCalledWith({signal: controller.signal})
  })

  it('throws if signal is aborted', async () => {
    const ctx = buildCtx({})
    const controller = new AbortController()
    controller.abort()

    await expect(info(ctx, 'postgres-curved-12345', {signal: controller.signal})).rejects.toThrow()
  })

  it('fires beforeInfo with the resolved addon before calling maintenance.info', async () => {
    const maintenanceInfo = vi.fn().mockResolvedValue({status: 'none'})
    const addonMock = buildAddon()
    const ctx = buildCtx({
      maintenanceInfo,
      resolution: vi.fn().mockResolvedValue([addonMock]),
    })
    const beforeInfo = vi.fn()

    await info(ctx, 'postgres-curved-12345', {beforeInfo})

    expect(beforeInfo).toHaveBeenCalledWith({addon: addonMock})
    expect(beforeInfo).toHaveBeenCalledBefore(maintenanceInfo)
  })

  it('throws before calling maintenance.info when beforeInfo throws', async () => {
    const maintenanceInfo = vi.fn().mockResolvedValue({status: 'none'})
    const ctx = buildCtx({
      maintenanceInfo,
      resolution: vi.fn().mockResolvedValue([buildAddon()]),
    })
    const beforeInfo = vi.fn().mockRejectedValue(new Error('declined'))

    await expect(info(ctx, 'postgres-curved-12345', {beforeInfo})).rejects.toThrow('declined')
    expect(maintenanceInfo).not.toHaveBeenCalled()
  })

  it('throws after beforeInfo if the signal is aborted', async () => {
    const maintenanceInfo = vi.fn().mockResolvedValue({status: 'none'})
    const controller = new AbortController()
    const ctx = buildCtx({
      maintenanceInfo,
      resolution: vi.fn().mockResolvedValue([buildAddon()]),
    })
    const beforeInfo = vi.fn(() => controller.abort())

    await expect(info(ctx, 'postgres-curved-12345', {beforeInfo, signal: controller.signal})).rejects.toThrow()
    expect(maintenanceInfo).not.toHaveBeenCalled()
  })
})
