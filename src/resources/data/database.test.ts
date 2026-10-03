import type {AddOn} from '@heroku/types/3.sdk'

import {
  describe, expect, it, vi,
} from 'vitest'

import type {ResourceCtx} from '../../core/extend-resource.js'

import {
  cancelUpgrade, databaseExtensions, describe as describeFn, dryRunUpgrade, prepareUpgrade, runUpgrade, upgradeWaitStatus,
} from './database.js'

function buildCtx(opts: {
  cancelUpgrade?: ReturnType<typeof vi.fn>
  databaseInfo?: ReturnType<typeof vi.fn>
  dryRunUpgrade?: ReturnType<typeof vi.fn>
  prepareUpgrade?: ReturnType<typeof vi.fn>
  resolution?: ReturnType<typeof vi.fn>
  runUpgrade?: ReturnType<typeof vi.fn>
  upgradeWaitStatus?: ReturnType<typeof vi.fn>
}): ResourceCtx {
  return {
    data: {
      database: {
        cancelUpgrade: opts.cancelUpgrade ?? vi.fn(),
        dryRunUpgrade: opts.dryRunUpgrade ?? vi.fn(),
        info: opts.databaseInfo ?? vi.fn(),
        prepareUpgrade: opts.prepareUpgrade ?? vi.fn(),
        runUpgrade: opts.runUpgrade ?? vi.fn(),
        upgradeWaitStatus: opts.upgradeWaitStatus ?? vi.fn(),
      },
    } as never,
    platform: {
      addOn: {resolution: opts.resolution ?? vi.fn()},
      addOnAttachment: {resolution: vi.fn()},
    } as never,
  }
}

const oneAddonMatch = [
  {
    // eslint-disable-next-line camelcase
    addon_service: {id: 'service-id', name: 'heroku-postgresql'},
    app: {id: 'app-uuid', name: 'app-1'},
    id: 'addon-1',
    name: 'pg-attached',
  } as AddOn,
]

describe('database resource', () => {
  it('describe resolves the addon by attachment and calls database.info', async () => {
    const resolution = vi.fn().mockResolvedValue(oneAddonMatch)
    const databaseInfo = vi.fn().mockResolvedValue({plan: 'standard-0'})
    const ctx = buildCtx({databaseInfo, resolution})

    const result = await describeFn(ctx, 'app-1', 'HEROKU_POSTGRESQL_BLUE')

    expect(resolution).toHaveBeenCalledWith({addon: 'HEROKU_POSTGRESQL_BLUE', app: 'app-1'})
    expect(databaseInfo).toHaveBeenCalledWith('addon-1')
    expect(result).toEqual({plan: 'standard-0'})
  })

  it('describe defaults to the DATABASE_URL attachment when no addonIdentity is given', async () => {
    const resolution = vi.fn().mockResolvedValue(oneAddonMatch)
    const databaseInfo = vi.fn().mockResolvedValue({})
    const ctx = buildCtx({databaseInfo, resolution})

    await describeFn(ctx, 'app-1')

    expect(resolution).toHaveBeenCalledWith({addon: 'DATABASE_URL', app: 'app-1'})
  })

  it('describe throws if signal is aborted', async () => {
    const ctx = buildCtx({})
    const controller = new AbortController()
    controller.abort()

    await expect(describeFn(ctx, 'app-1', undefined, {signal: controller.signal})).rejects.toThrow()
  })

  it('runUpgrade resolves the addon and calls database.runUpgrade with the body', async () => {
    const resolution = vi.fn().mockResolvedValue(oneAddonMatch)
    const runUpgradeFn = vi.fn().mockResolvedValue({message: 'upgrading'})
    const ctx = buildCtx({resolution, runUpgrade: runUpgradeFn})

    const result = await runUpgrade(ctx, 'app-1', 'DATABASE_URL', {version: '17'})

    expect(runUpgradeFn).toHaveBeenCalledWith('addon-1', {version: '17'})
    expect(result).toEqual({message: 'upgrading'})
  })

  it('runUpgrade defaults to an empty body when none is provided', async () => {
    const resolution = vi.fn().mockResolvedValue(oneAddonMatch)
    const runUpgradeFn = vi.fn().mockResolvedValue({})
    const ctx = buildCtx({resolution, runUpgrade: runUpgradeFn})

    await runUpgrade(ctx, 'app-1')

    expect(runUpgradeFn).toHaveBeenCalledWith('addon-1', {})
  })

  it('prepareUpgrade resolves the addon and calls database.prepareUpgrade', async () => {
    const resolution = vi.fn().mockResolvedValue(oneAddonMatch)
    const prepareUpgradeFn = vi.fn().mockResolvedValue({message: 'scheduled'})
    const ctx = buildCtx({prepareUpgrade: prepareUpgradeFn, resolution})

    const result = await prepareUpgrade(ctx, 'app-1', 'DATABASE_URL', {version: '17'})

    expect(prepareUpgradeFn).toHaveBeenCalledWith('addon-1', {version: '17'})
    expect(result).toEqual({message: 'scheduled'})
  })

  it('dryRunUpgrade resolves the addon and calls database.dryRunUpgrade', async () => {
    const resolution = vi.fn().mockResolvedValue(oneAddonMatch)
    const dryRunUpgradeFn = vi.fn().mockResolvedValue({message: 'dry run complete'})
    const ctx = buildCtx({dryRunUpgrade: dryRunUpgradeFn, resolution})

    const result = await dryRunUpgrade(ctx, 'app-1', 'DATABASE_URL', {version: '17'})

    expect(dryRunUpgradeFn).toHaveBeenCalledWith('addon-1', {version: '17'})
    expect(result).toEqual({message: 'dry run complete'})
  })

  it('upgradeWaitStatus resolves the addon and calls database.upgradeWaitStatus', async () => {
    const resolution = vi.fn().mockResolvedValue(oneAddonMatch)
    const upgradeWaitStatusFn = vi.fn().mockResolvedValue({
      'error?': false, message: 'upgrading', step: 'wait_for_data_sync', 'waiting?': true,
    })
    const ctx = buildCtx({resolution, upgradeWaitStatus: upgradeWaitStatusFn})

    const result = await upgradeWaitStatus(ctx, 'app-1', 'DATABASE_URL')

    expect(upgradeWaitStatusFn).toHaveBeenCalledWith('addon-1')
    expect(result).toEqual({
      'error?': false, message: 'upgrading', step: 'wait_for_data_sync', 'waiting?': true,
    })
  })

  it('cancelUpgrade resolves the addon and calls database.cancelUpgrade', async () => {
    const resolution = vi.fn().mockResolvedValue(oneAddonMatch)
    const cancelUpgradeFn = vi.fn().mockResolvedValue({message: 'cancelled'})
    const ctx = buildCtx({cancelUpgrade: cancelUpgradeFn, resolution})

    const result = await cancelUpgrade(ctx, 'app-1', 'DATABASE_URL')

    expect(resolution).toHaveBeenCalledWith({addon: 'DATABASE_URL', app: 'app-1'})
    expect(cancelUpgradeFn).toHaveBeenCalledWith('addon-1')
    expect(result).toEqual({message: 'cancelled'})
  })

  it('cancelUpgrade throws if signal is aborted', async () => {
    const ctx = buildCtx({})
    const controller = new AbortController()
    controller.abort()

    await expect(cancelUpgrade(ctx, 'app-1', undefined, {signal: controller.signal})).rejects.toThrow()
  })

  it('databaseExtensions declares service: data, resource: database', () => {
    expect(databaseExtensions.service).toBe('data')
    expect(databaseExtensions.resource).toBe('database')
  })

  it('databaseExtensions factory exposes all methods', () => {
    const methods = databaseExtensions.factory(buildCtx({}))
    expect(typeof methods.cancelUpgrade).toBe('function')
    expect(typeof methods.describe).toBe('function')
    expect(typeof methods.dryRunUpgrade).toBe('function')
    expect(typeof methods.prepareUpgrade).toBe('function')
    expect(typeof methods.runUpgrade).toBe('function')
    expect(typeof methods.upgradeWaitStatus).toBe('function')
  })
})
