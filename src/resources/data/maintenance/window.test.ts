import {
  describe, expect, it, vi,
} from 'vitest'

import type {ResourceCtx} from '../../../core/extend-resource.js'

import {getWindow, updateWindow} from './window.js'

function buildCtx(opts: {
  maintenanceUpdateWindow?: ReturnType<typeof vi.fn>
  maintenanceWindow?: ReturnType<typeof vi.fn>
  resolution?: ReturnType<typeof vi.fn>
}): Pick<ResourceCtx, 'data' | 'platform'> {
  const dataClient = {
    maintenance: {
      updateWindow: opts.maintenanceUpdateWindow ?? vi.fn(),
      window: opts.maintenanceWindow ?? vi.fn(),
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

describe('maintenance getWindow', () => {
  it('resolves the addon and calls maintenance.window', async () => {
    const addonMock = buildAddon()
    const resolution = vi.fn().mockResolvedValue([addonMock])
    const maintenanceWindow = vi.fn().mockResolvedValue({window: 'sunday 13:30'})
    const ctx = buildCtx({maintenanceWindow, resolution})

    const result = await getWindow(ctx, 'postgres-curved-12345')

    expect(maintenanceWindow).toHaveBeenCalledWith('addon-1')
    expect(result.window).toEqual({window: 'sunday 13:30'})
    expect(result.addon).toEqual(addonMock)
  })

  it('scopes resolution by appIdentity when given', async () => {
    const resolution = vi.fn().mockResolvedValue([buildAddon()])
    const ctx = buildCtx({
      maintenanceWindow: vi.fn().mockResolvedValue({}),
      resolution,
    })

    await getWindow(ctx, 'DATABASE_URL', {appIdentity: 'app-1'})

    expect(resolution).toHaveBeenCalledWith({addon: 'DATABASE_URL', app: 'app-1'})
  })

  it('binds the signal to the data client so the request aborts in flight', async () => {
    const ctx = buildCtx({
      maintenanceWindow: vi.fn().mockResolvedValue({}),
      resolution: vi.fn().mockResolvedValue([buildAddon()]),
    })
    const controller = new AbortController()

    await getWindow(ctx, 'postgres-curved-12345', {signal: controller.signal})

    expect(ctx.data.withOptions).toHaveBeenCalledWith({signal: controller.signal})
  })

  it('throws if signal is aborted', async () => {
    const ctx = buildCtx({})
    const controller = new AbortController()
    controller.abort()

    await expect(getWindow(ctx, 'postgres-curved-12345', {signal: controller.signal})).rejects.toThrow()
  })

  it('fires beforeGetWindow with the resolved addon before calling maintenance.window', async () => {
    const maintenanceWindow = vi.fn().mockResolvedValue({})
    const addonMock = buildAddon()
    const ctx = buildCtx({
      maintenanceWindow,
      resolution: vi.fn().mockResolvedValue([addonMock]),
    })
    const beforeGetWindow = vi.fn()

    await getWindow(ctx, 'postgres-curved-12345', {beforeGetWindow})

    expect(beforeGetWindow).toHaveBeenCalledWith({addon: addonMock})
    expect(beforeGetWindow).toHaveBeenCalledBefore(maintenanceWindow)
  })

  it('throws before calling maintenance.window when beforeGetWindow throws', async () => {
    const maintenanceWindow = vi.fn().mockResolvedValue({})
    const ctx = buildCtx({
      maintenanceWindow,
      resolution: vi.fn().mockResolvedValue([buildAddon()]),
    })
    const beforeGetWindow = vi.fn().mockRejectedValue(new Error('declined'))

    await expect(getWindow(ctx, 'postgres-curved-12345', {beforeGetWindow})).rejects.toThrow('declined')
    expect(maintenanceWindow).not.toHaveBeenCalled()
  })

  it('throws after beforeGetWindow if the signal is aborted', async () => {
    const maintenanceWindow = vi.fn().mockResolvedValue({})
    const controller = new AbortController()
    const ctx = buildCtx({
      maintenanceWindow,
      resolution: vi.fn().mockResolvedValue([buildAddon()]),
    })
    const beforeGetWindow = vi.fn(() => controller.abort())

    await expect(getWindow(ctx, 'postgres-curved-12345', {beforeGetWindow, signal: controller.signal})).rejects.toThrow()
    expect(maintenanceWindow).not.toHaveBeenCalled()
  })
})

describe('maintenance updateWindow', () => {
  // eslint-disable-next-line camelcase
  const body = {day_of_week: 'sunday', time_of_day: '13:30'}

  it('resolves the addon and calls maintenance.updateWindow', async () => {
    const addonMock = buildAddon()
    const resolution = vi.fn().mockResolvedValue([addonMock])
    const maintenanceUpdateWindow = vi.fn().mockResolvedValue({window: 'sunday 13:30'})
    const ctx = buildCtx({maintenanceUpdateWindow, resolution})

    const result = await updateWindow(ctx, 'postgres-curved-12345', body)

    expect(maintenanceUpdateWindow).toHaveBeenCalledWith('addon-1', body)
    expect(result.window).toEqual({window: 'sunday 13:30'})
    expect(result.addon).toEqual(addonMock)
  })

  it('scopes resolution by appIdentity when given', async () => {
    const resolution = vi.fn().mockResolvedValue([buildAddon()])
    const ctx = buildCtx({
      maintenanceUpdateWindow: vi.fn().mockResolvedValue({}),
      resolution,
    })

    await updateWindow(ctx, 'DATABASE_URL', body, {appIdentity: 'app-1'})

    expect(resolution).toHaveBeenCalledWith({addon: 'DATABASE_URL', app: 'app-1'})
  })

  it('binds the signal to the data client so the request aborts in flight', async () => {
    const ctx = buildCtx({
      maintenanceUpdateWindow: vi.fn().mockResolvedValue({}),
      resolution: vi.fn().mockResolvedValue([buildAddon()]),
    })
    const controller = new AbortController()

    await updateWindow(ctx, 'postgres-curved-12345', body, {signal: controller.signal})

    expect(ctx.data.withOptions).toHaveBeenCalledWith({signal: controller.signal})
  })

  it('throws if signal is aborted', async () => {
    const ctx = buildCtx({})
    const controller = new AbortController()
    controller.abort()

    await expect(updateWindow(ctx, 'postgres-curved-12345', body, {signal: controller.signal})).rejects.toThrow()
  })

  it('fires beforeUpdateWindow with the resolved addon before calling maintenance.updateWindow', async () => {
    const maintenanceUpdateWindow = vi.fn().mockResolvedValue({})
    const addonMock = buildAddon()
    const ctx = buildCtx({
      maintenanceUpdateWindow,
      resolution: vi.fn().mockResolvedValue([addonMock]),
    })
    const beforeUpdateWindow = vi.fn()

    await updateWindow(ctx, 'postgres-curved-12345', body, {beforeUpdateWindow})

    expect(beforeUpdateWindow).toHaveBeenCalledWith({addon: addonMock})
    expect(beforeUpdateWindow).toHaveBeenCalledBefore(maintenanceUpdateWindow)
  })

  it('throws before calling maintenance.updateWindow when beforeUpdateWindow throws', async () => {
    const maintenanceUpdateWindow = vi.fn().mockResolvedValue({})
    const ctx = buildCtx({
      maintenanceUpdateWindow,
      resolution: vi.fn().mockResolvedValue([buildAddon()]),
    })
    const beforeUpdateWindow = vi.fn().mockRejectedValue(new Error('declined'))

    await expect(updateWindow(ctx, 'postgres-curved-12345', body, {beforeUpdateWindow})).rejects.toThrow('declined')
    expect(maintenanceUpdateWindow).not.toHaveBeenCalled()
  })

  it('throws after beforeUpdateWindow if the signal is aborted', async () => {
    const maintenanceUpdateWindow = vi.fn().mockResolvedValue({})
    const controller = new AbortController()
    const ctx = buildCtx({
      maintenanceUpdateWindow,
      resolution: vi.fn().mockResolvedValue([buildAddon()]),
    })
    const beforeUpdateWindow = vi.fn(() => controller.abort())

    await expect(updateWindow(ctx, 'postgres-curved-12345', body, {beforeUpdateWindow, signal: controller.signal}))
      .rejects.toThrow()
    expect(maintenanceUpdateWindow).not.toHaveBeenCalled()
  })
})
