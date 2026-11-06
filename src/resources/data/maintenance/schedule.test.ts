import {
  describe, expect, it, vi,
} from 'vitest'

import type {ResourceCtx} from '../../../core/extend-resource.js'

import {schedule} from './schedule.js'

function buildCtx(opts: {
  maintenanceSchedule?: ReturnType<typeof vi.fn>
  resolution?: ReturnType<typeof vi.fn>
}): Pick<ResourceCtx, 'data' | 'platform'> {
  const dataClient = {
    maintenance: {
      schedule: opts.maintenanceSchedule ?? vi.fn(),
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

// eslint-disable-next-line camelcase
const body = {delay_weeks: 2}
// eslint-disable-next-line camelcase
const scheduleResult = {scheduled_for: '2026-01-01'}

describe('maintenance schedule', () => {
  it('resolves the addon and calls maintenance.schedule', async () => {
    const addonMock = buildAddon()
    const resolution = vi.fn().mockResolvedValue([addonMock])
    const maintenanceSchedule = vi.fn().mockResolvedValue(scheduleResult)
    const ctx = buildCtx({maintenanceSchedule, resolution})

    const result = await schedule(ctx, 'postgres-curved-12345', body)

    expect(maintenanceSchedule).toHaveBeenCalledWith('addon-1', body)
    expect(result.schedule).toEqual(scheduleResult)
    expect(result.addon).toEqual(addonMock)
  })

  it('scopes resolution by appIdentity when given', async () => {
    const resolution = vi.fn().mockResolvedValue([buildAddon()])
    const ctx = buildCtx({
      maintenanceSchedule: vi.fn().mockResolvedValue({}),
      resolution,
    })

    await schedule(ctx, 'DATABASE_URL', body, {appIdentity: 'app-1'})

    expect(resolution).toHaveBeenCalledWith({addon: 'DATABASE_URL', app: 'app-1'})
  })

  it('binds the signal to the data client so the request aborts in flight', async () => {
    const ctx = buildCtx({
      maintenanceSchedule: vi.fn().mockResolvedValue({}),
      resolution: vi.fn().mockResolvedValue([buildAddon()]),
    })
    const controller = new AbortController()

    await schedule(ctx, 'postgres-curved-12345', body, {signal: controller.signal})

    expect(ctx.data.withOptions).toHaveBeenCalledWith({signal: controller.signal})
  })

  it('throws if signal is aborted', async () => {
    const ctx = buildCtx({})
    const controller = new AbortController()
    controller.abort()

    await expect(schedule(ctx, 'postgres-curved-12345', body, {signal: controller.signal})).rejects.toThrow()
  })

  it('fires beforeSchedule with the resolved addon before calling maintenance.schedule', async () => {
    const maintenanceSchedule = vi.fn().mockResolvedValue({})
    const addonMock = buildAddon()
    const ctx = buildCtx({
      maintenanceSchedule,
      resolution: vi.fn().mockResolvedValue([addonMock]),
    })
    const beforeSchedule = vi.fn()

    await schedule(ctx, 'postgres-curved-12345', body, {beforeSchedule})

    expect(beforeSchedule).toHaveBeenCalledWith({addon: addonMock})
    expect(beforeSchedule).toHaveBeenCalledBefore(maintenanceSchedule)
  })

  it('throws before calling maintenance.schedule when beforeSchedule throws', async () => {
    const maintenanceSchedule = vi.fn().mockResolvedValue({})
    const ctx = buildCtx({
      maintenanceSchedule,
      resolution: vi.fn().mockResolvedValue([buildAddon()]),
    })
    const beforeSchedule = vi.fn().mockRejectedValue(new Error('declined'))

    await expect(schedule(ctx, 'postgres-curved-12345', body, {beforeSchedule})).rejects.toThrow('declined')
    expect(maintenanceSchedule).not.toHaveBeenCalled()
  })

  it('throws after beforeSchedule if the signal is aborted', async () => {
    const maintenanceSchedule = vi.fn().mockResolvedValue({})
    const controller = new AbortController()
    const ctx = buildCtx({
      maintenanceSchedule,
      resolution: vi.fn().mockResolvedValue([buildAddon()]),
    })
    const beforeSchedule = vi.fn(() => controller.abort())

    await expect(schedule(ctx, 'postgres-curved-12345', body, {beforeSchedule, signal: controller.signal}))
      .rejects.toThrow()
    expect(maintenanceSchedule).not.toHaveBeenCalled()
  })
})
