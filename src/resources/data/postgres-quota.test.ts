/* eslint-disable camelcase */
import {
  describe, expect, it, vi,
} from 'vitest'

import type {ResourceCtx} from '../../core/extend-resource.js'

import {NotAdvancedDatabaseError} from './internal/postgres-utils.js'
import {
  info, list, postgresQuotaExtensions, update,
} from './postgres-quota.js'

function buildCtx(opts: {
  postgresQuotaInfo?: ReturnType<typeof vi.fn>
  postgresQuotaList?: ReturnType<typeof vi.fn>
  postgresQuotaUpdate?: ReturnType<typeof vi.fn>
  resolution?: ReturnType<typeof vi.fn>
}): Pick<ResourceCtx, 'data' | 'platform'> {
  const dataClient = {
    postgresQuota: {
      info: opts.postgresQuotaInfo ?? vi.fn(),
      list: opts.postgresQuotaList ?? vi.fn(),
      update: opts.postgresQuotaUpdate ?? vi.fn(),
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

describe('postgres quota list', () => {
  it('lists quotas on an Advanced-tier database via postgresQuota.list', async () => {
    const addonMock = buildAddon({planName: 'heroku-postgresql:advanced-0'})
    const resolution = vi.fn().mockResolvedValue([addonMock])
    const postgresQuotaList = vi.fn().mockResolvedValue({items: [{current_gb: 1, type: 'storage'}]})
    const ctx = buildCtx({postgresQuotaList, resolution})

    const {addon, quotas} = await list(ctx, 'postgres-curved-12345')

    expect(postgresQuotaList).toHaveBeenCalledWith('addon-1')
    expect(quotas).toEqual({items: [{current_gb: 1, type: 'storage'}]})
    expect(addon).toEqual(addonMock)
  })

  it('throws NotAdvancedDatabaseError with the resolved addon for classic-tier databases', async () => {
    const addonMock = buildAddon({planName: 'heroku-postgresql:standard-0'})
    const postgresQuotaList = vi.fn()
    const ctx = buildCtx({postgresQuotaList, resolution: vi.fn().mockResolvedValue([addonMock])})

    const error = await list(ctx, 'postgres-curved-12345').catch((error_: unknown) => error_)

    expect(error).toBeInstanceOf(NotAdvancedDatabaseError)
    expect((error as NotAdvancedDatabaseError).addon).toEqual(addonMock)
    expect(postgresQuotaList).not.toHaveBeenCalled()
  })

  it('scopes resolution by appIdentity when given', async () => {
    const resolution = vi.fn().mockResolvedValue([buildAddon({planName: 'heroku-postgresql:advanced-0'})])
    const ctx = buildCtx({
      postgresQuotaList: vi.fn().mockResolvedValue({items: []}),
      resolution,
    })

    await list(ctx, 'DATABASE_URL', {appIdentity: 'app-1'})

    expect(resolution).toHaveBeenCalledWith({addon: 'DATABASE_URL', app: 'app-1'})
  })

  it('binds the signal to the data client so the request aborts in flight', async () => {
    const ctx = buildCtx({
      postgresQuotaList: vi.fn().mockResolvedValue({items: []}),
      resolution: vi.fn().mockResolvedValue([buildAddon({planName: 'heroku-postgresql:advanced-0'})]),
    })
    const controller = new AbortController()

    await list(ctx, 'postgres-curved-12345', {signal: controller.signal})

    expect(ctx.data.withOptions).toHaveBeenCalledWith({signal: controller.signal})
  })

  it('throws if signal is aborted', async () => {
    const ctx = buildCtx({})
    const controller = new AbortController()
    controller.abort()

    await expect(list(ctx, 'postgres-curved-12345', {signal: controller.signal})).rejects.toThrow()
  })
})

describe('postgres quota info', () => {
  it('fetches a single quota on an Advanced-tier database via postgresQuota.info', async () => {
    const addonMock = buildAddon({planName: 'heroku-postgresql:advanced-0'})
    const resolution = vi.fn().mockResolvedValue([addonMock])
    const postgresQuotaInfo = vi.fn().mockResolvedValue({current_gb: 1, type: 'storage'})
    const ctx = buildCtx({postgresQuotaInfo, resolution})

    const {addon, quota} = await info(ctx, 'postgres-curved-12345', 'storage')

    expect(postgresQuotaInfo).toHaveBeenCalledWith('addon-1', 'storage')
    expect(quota).toEqual({current_gb: 1, type: 'storage'})
    expect(addon).toEqual(addonMock)
  })

  it('throws NotAdvancedDatabaseError with the resolved addon for classic-tier databases', async () => {
    const addonMock = buildAddon({planName: 'heroku-postgresql:standard-0'})
    const postgresQuotaInfo = vi.fn()
    const ctx = buildCtx({postgresQuotaInfo, resolution: vi.fn().mockResolvedValue([addonMock])})

    const error = await info(ctx, 'postgres-curved-12345', 'storage').catch((error_: unknown) => error_)

    expect(error).toBeInstanceOf(NotAdvancedDatabaseError)
    expect((error as NotAdvancedDatabaseError).addon).toEqual(addonMock)
    expect(postgresQuotaInfo).not.toHaveBeenCalled()
  })
})

describe('postgres quota update', () => {
  it('updates a quota on an Advanced-tier database via postgresQuota.update', async () => {
    const addonMock = buildAddon({planName: 'heroku-postgresql:advanced-0'})
    const resolution = vi.fn().mockResolvedValue([addonMock])
    const postgresQuotaUpdate = vi.fn().mockResolvedValue({current_gb: 1, type: 'storage', warning_gb: 5})
    const ctx = buildCtx({postgresQuotaUpdate, resolution})

    const {addon, quota} = await update(ctx, 'postgres-curved-12345', 'storage', {warning_gb: 5})

    expect(postgresQuotaUpdate).toHaveBeenCalledWith('addon-1', 'storage', {warning_gb: 5})
    expect(quota).toEqual({current_gb: 1, type: 'storage', warning_gb: 5})
    expect(addon).toEqual(addonMock)
  })

  it('throws NotAdvancedDatabaseError with the resolved addon for classic-tier databases', async () => {
    const addonMock = buildAddon({planName: 'heroku-postgresql:standard-0'})
    const postgresQuotaUpdate = vi.fn()
    const ctx = buildCtx({postgresQuotaUpdate, resolution: vi.fn().mockResolvedValue([addonMock])})

    const error = await update(ctx, 'postgres-curved-12345', 'storage', {warning_gb: 5}).catch((error_: unknown) => error_)

    expect(error).toBeInstanceOf(NotAdvancedDatabaseError)
    expect((error as NotAdvancedDatabaseError).addon).toEqual(addonMock)
    expect(postgresQuotaUpdate).not.toHaveBeenCalled()
  })
})

describe('postgresQuotaExtensions', () => {
  it('overlays the data postgresQuota resource', () => {
    expect(postgresQuotaExtensions.service).toBe('data')
    expect(postgresQuotaExtensions.resource).toBe('postgresQuota')
  })
})
