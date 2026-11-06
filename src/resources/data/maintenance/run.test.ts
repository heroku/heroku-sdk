import {
  describe, expect, it, vi,
} from 'vitest'

import type {ResourceCtx} from '../../../core/extend-resource.js'

import {run} from './run.js'

function buildCtx(opts: {
  maintenanceRun?: ReturnType<typeof vi.fn>
  resolution?: ReturnType<typeof vi.fn>
}): Pick<ResourceCtx, 'data' | 'platform'> {
  const dataClient = {
    maintenance: {
      run: opts.maintenanceRun ?? vi.fn(),
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

function buildAddon(planName: string = 'heroku-postgresql:standard-0') {
  return {
    // eslint-disable-next-line camelcase
    addon_service: {name: 'heroku-postgresql'},
    app: {id: 'app-uuid', name: 'app-1'},
    id: 'addon-1',
    name: 'postgres-curved-12345',
    plan: {name: planName},
  }
}

describe('maintenance run', () => {
  it('resolves the addon and calls maintenance.run', async () => {
    const addonMock = buildAddon()
    const resolution = vi.fn().mockResolvedValue([addonMock])
    const maintenanceRun = vi.fn().mockResolvedValue({message: 'triggered'})
    const ctx = buildCtx({maintenanceRun, resolution})

    const {addon, result} = await run(ctx, 'postgres-curved-12345')

    expect(maintenanceRun).toHaveBeenCalledWith('addon-1')
    expect(result).toEqual({message: 'triggered'})
    expect(addon).toEqual(addonMock)
  })

  it('scopes resolution by appIdentity when given', async () => {
    const resolution = vi.fn().mockResolvedValue([buildAddon()])
    const ctx = buildCtx({
      maintenanceRun: vi.fn().mockResolvedValue({message: 'triggered'}),
      resolution,
    })

    await run(ctx, 'DATABASE_URL', {appIdentity: 'app-1'})

    expect(resolution).toHaveBeenCalledWith({addon: 'DATABASE_URL', app: 'app-1'})
  })

  it('throws for an essential tier database without calling beforeRun or maintenance.run', async () => {
    const essentialAddon = buildAddon('heroku-postgresql:essential-0')
    const maintenanceRun = vi.fn().mockResolvedValue({message: 'triggered'})
    const resolution = vi.fn().mockResolvedValue([essentialAddon])
    const ctx = buildCtx({maintenanceRun, resolution})
    const beforeRun = vi.fn()

    await expect(run(ctx, 'postgres-curved-12345', {beforeRun}))
      .rejects.toThrow('You can\'t trigger maintenance on an Essential tier database.')
    expect(beforeRun).not.toHaveBeenCalled()
    expect(maintenanceRun).not.toHaveBeenCalled()
  })

  it('binds the signal to the data client so the request aborts in flight', async () => {
    const ctx = buildCtx({
      maintenanceRun: vi.fn().mockResolvedValue({message: 'triggered'}),
      resolution: vi.fn().mockResolvedValue([buildAddon()]),
    })
    const controller = new AbortController()

    await run(ctx, 'postgres-curved-12345', {signal: controller.signal})

    expect(ctx.data.withOptions).toHaveBeenCalledWith({signal: controller.signal})
  })

  it('throws if signal is aborted', async () => {
    const ctx = buildCtx({})
    const controller = new AbortController()
    controller.abort()

    await expect(run(ctx, 'postgres-curved-12345', {signal: controller.signal})).rejects.toThrow()
  })

  it('fires beforeRun with the resolved addon before calling maintenance.run', async () => {
    const maintenanceRun = vi.fn().mockResolvedValue({message: 'triggered'})
    const addonMock = buildAddon()
    const ctx = buildCtx({
      maintenanceRun,
      resolution: vi.fn().mockResolvedValue([addonMock]),
    })
    const beforeRun = vi.fn()

    await run(ctx, 'postgres-curved-12345', {beforeRun})

    expect(beforeRun).toHaveBeenCalledWith({addon: addonMock})
    expect(beforeRun).toHaveBeenCalledBefore(maintenanceRun)
  })

  it('throws before calling maintenance.run when beforeRun throws', async () => {
    const maintenanceRun = vi.fn().mockResolvedValue({message: 'triggered'})
    const ctx = buildCtx({
      maintenanceRun,
      resolution: vi.fn().mockResolvedValue([buildAddon()]),
    })
    const beforeRun = vi.fn().mockRejectedValue(new Error('declined'))

    await expect(run(ctx, 'postgres-curved-12345', {beforeRun})).rejects.toThrow('declined')
    expect(maintenanceRun).not.toHaveBeenCalled()
  })

  it('throws after beforeRun if the signal is aborted', async () => {
    const maintenanceRun = vi.fn().mockResolvedValue({message: 'triggered'})
    const controller = new AbortController()
    const ctx = buildCtx({
      maintenanceRun,
      resolution: vi.fn().mockResolvedValue([buildAddon()]),
    })
    const beforeRun = vi.fn(() => controller.abort())

    await expect(run(ctx, 'postgres-curved-12345', {beforeRun, signal: controller.signal})).rejects.toThrow()
    expect(maintenanceRun).not.toHaveBeenCalled()
  })
})
