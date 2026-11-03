/* eslint-disable camelcase */
import {
  describe, expect, it, vi,
} from 'vitest'

import type {ResourceCtx} from '../../core/extend-resource.js'

import {NotAdvancedDatabaseError} from './internal/postgres-utils.js'
import {
  info, postgresSettingsExtensions, update,
} from './postgres-settings.js'

function buildCtx(opts: {
  postgresSettingsInfo?: ReturnType<typeof vi.fn>
  postgresSettingsUpdate?: ReturnType<typeof vi.fn>
  resolution?: ReturnType<typeof vi.fn>
}): Pick<ResourceCtx, 'data' | 'platform'> {
  const dataClient = {
    postgresSettings: {
      info: opts.postgresSettingsInfo ?? vi.fn(),
      update: opts.postgresSettingsUpdate ?? vi.fn(),
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

function buildAddon(opts: {planName: string}) {
  return {
    addon_service: {name: 'heroku-postgresql'},
    app: {id: 'app-uuid', name: 'app-1'},
    id: 'addon-1',
    name: 'pg-addon',
    plan: {name: opts.planName},
  }
}

describe('postgres settings info', () => {
  it('reads settings on an Advanced-tier database via postgresSettings.info', async () => {
    const addonMock = buildAddon({planName: 'heroku-postgresql:advanced-0'})
    const resolution = vi.fn().mockResolvedValue([addonMock])
    const postgresSettingsInfo = vi.fn().mockResolvedValue({items: [{current: true, name: 'log_connections'}]})
    const ctx = buildCtx({postgresSettingsInfo, resolution})

    const {addon, settings} = await info(ctx, 'postgres-curved-12345')

    expect(postgresSettingsInfo).toHaveBeenCalledWith('addon-1')
    expect(settings).toEqual({items: [{current: true, name: 'log_connections'}]})
    expect(addon).toEqual(addonMock)
  })

  it('throws NotAdvancedDatabaseError with the resolved addon for classic-tier databases', async () => {
    const addonMock = buildAddon({planName: 'heroku-postgresql:standard-0'})
    const postgresSettingsInfo = vi.fn()
    const ctx = buildCtx({postgresSettingsInfo, resolution: vi.fn().mockResolvedValue([addonMock])})

    const error = await info(ctx, 'postgres-curved-12345').catch((error_: unknown) => error_)

    expect(error).toBeInstanceOf(NotAdvancedDatabaseError)
    expect((error as NotAdvancedDatabaseError).addon).toEqual(addonMock)
    expect(postgresSettingsInfo).not.toHaveBeenCalled()
  })

  it('scopes resolution by appIdentity when given', async () => {
    const resolution = vi.fn().mockResolvedValue([buildAddon({planName: 'heroku-postgresql:advanced-0'})])
    const ctx = buildCtx({
      postgresSettingsInfo: vi.fn().mockResolvedValue({items: []}),
      resolution,
    })

    await info(ctx, 'DATABASE_URL', {appIdentity: 'app-1'})

    expect(resolution).toHaveBeenCalledWith({addon: 'DATABASE_URL', app: 'app-1'})
  })

  it('binds the signal to the data client so the request aborts in flight', async () => {
    const ctx = buildCtx({
      postgresSettingsInfo: vi.fn().mockResolvedValue({items: []}),
      resolution: vi.fn().mockResolvedValue([buildAddon({planName: 'heroku-postgresql:advanced-0'})]),
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
})

describe('postgres settings update', () => {
  it('updates settings on an Advanced-tier database via postgresSettings.update', async () => {
    const addonMock = buildAddon({planName: 'heroku-postgresql:advanced-0'})
    const resolution = vi.fn().mockResolvedValue([addonMock])
    const postgresSettingsUpdate = vi.fn().mockResolvedValue({changes: [{current: 500, name: 'log_min_duration_statement', previous: 550}]})
    const ctx = buildCtx({postgresSettingsUpdate, resolution})

    const {addon, settings} = await update(ctx, 'postgres-curved-12345', {settings: 'log_min_duration_statement:500'})

    expect(postgresSettingsUpdate).toHaveBeenCalledWith('addon-1', {settings: 'log_min_duration_statement:500'})
    expect(settings).toEqual({changes: [{current: 500, name: 'log_min_duration_statement', previous: 550}]})
    expect(addon).toEqual(addonMock)
  })

  it('throws NotAdvancedDatabaseError with the resolved addon for classic-tier databases', async () => {
    const addonMock = buildAddon({planName: 'heroku-postgresql:standard-0'})
    const postgresSettingsUpdate = vi.fn()
    const ctx = buildCtx({postgresSettingsUpdate, resolution: vi.fn().mockResolvedValue([addonMock])})

    const error = await update(ctx, 'postgres-curved-12345', {settings: 'log_min_duration_statement:500'}).catch((error_: unknown) => error_)

    expect(error).toBeInstanceOf(NotAdvancedDatabaseError)
    expect((error as NotAdvancedDatabaseError).addon).toEqual(addonMock)
    expect(postgresSettingsUpdate).not.toHaveBeenCalled()
  })
})

describe('postgresSettingsExtensions', () => {
  it('overlays the data postgresSettings resource', () => {
    expect(postgresSettingsExtensions.service).toBe('data')
    expect(postgresSettingsExtensions.resource).toBe('postgresSettings')
  })
})
