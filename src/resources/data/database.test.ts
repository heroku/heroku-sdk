import type {AddOnAttachment} from '@heroku/types/3.sdk'

import {
  describe, expect, it, vi,
} from 'vitest'

import type {ResourceCtx} from '../../core/extend-resource.js'

import {
  databaseExtensions, describe_ as describeFn, prepareUpgrade, runUpgrade,
} from './database.js'

function buildCtx(opts: {
  databaseInfo?: ReturnType<typeof vi.fn>;
  prepareUpgrade?: ReturnType<typeof vi.fn>;
  resolution?: ReturnType<typeof vi.fn>;
  runUpgrade?: ReturnType<typeof vi.fn>;
}): ResourceCtx {
  return {
    data: {
      database: {
        info: opts.databaseInfo ?? vi.fn(),
        prepareUpgrade: opts.prepareUpgrade ?? vi.fn(),
        runUpgrade: opts.runUpgrade ?? vi.fn(),
      },
    } as never,
    platform: {
      addOnAttachment: {
        resolution: opts.resolution ?? vi.fn(),
      },
    } as never,
  }
}

const oneMatch = [{addon: {id: 'addon-1'}}] as AddOnAttachment[]

describe('database resource', () => {
  it('describe_ resolves the addon and calls database.info', async () => {
    const resolution = vi.fn().mockResolvedValue(oneMatch)
    const databaseInfo = vi.fn().mockResolvedValue({plan: 'standard-0'})
    const ctx = buildCtx({databaseInfo, resolution})

    const result = await describeFn(ctx, 'app-1', 'HEROKU_POSTGRESQL_BLUE')

    // eslint-disable-next-line camelcase
    expect(resolution).toHaveBeenCalledWith({addon_attachment: 'HEROKU_POSTGRESQL_BLUE', app: 'app-1'})
    expect(databaseInfo).toHaveBeenCalledWith('addon-1')
    expect(result).toEqual({plan: 'standard-0'})
  })

  it('describe_ throws if signal is aborted', async () => {
    const ctx = buildCtx({})
    const controller = new AbortController()
    controller.abort()

    await expect(describeFn(ctx, 'app-1', undefined, {signal: controller.signal})).rejects.toThrow()
  })

  it('runUpgrade resolves the addon and calls database.runUpgrade with the body', async () => {
    const resolution = vi.fn().mockResolvedValue(oneMatch)
    const runUpgradeFn = vi.fn().mockResolvedValue({message: 'upgrading'})
    const ctx = buildCtx({resolution, runUpgrade: runUpgradeFn})

    const result = await runUpgrade(ctx, 'app-1', 'DATABASE_URL', {version: '17'})

    expect(runUpgradeFn).toHaveBeenCalledWith('addon-1', {version: '17'})
    expect(result).toEqual({message: 'upgrading'})
  })

  it('runUpgrade defaults to an empty body when none is provided', async () => {
    const resolution = vi.fn().mockResolvedValue(oneMatch)
    const runUpgradeFn = vi.fn().mockResolvedValue({})
    const ctx = buildCtx({resolution, runUpgrade: runUpgradeFn})

    await runUpgrade(ctx, 'app-1')

    expect(runUpgradeFn).toHaveBeenCalledWith('addon-1', {})
  })

  it('prepareUpgrade resolves the addon and calls database.prepareUpgrade', async () => {
    const resolution = vi.fn().mockResolvedValue(oneMatch)
    const prepareUpgradeFn = vi.fn().mockResolvedValue({message: 'scheduled'})
    const ctx = buildCtx({prepareUpgrade: prepareUpgradeFn, resolution})

    const result = await prepareUpgrade(ctx, 'app-1', 'DATABASE_URL', {version: '17'})

    expect(prepareUpgradeFn).toHaveBeenCalledWith('addon-1', {version: '17'})
    expect(result).toEqual({message: 'scheduled'})
  })

  it('databaseExtensions declares service: data, resource: database', () => {
    expect(databaseExtensions.service).toBe('data')
    expect(databaseExtensions.resource).toBe('database')
  })

  it('databaseExtensions factory exposes describe, runUpgrade, prepareUpgrade', () => {
    const methods = databaseExtensions.factory(buildCtx({}))
    expect(typeof methods.describe).toBe('function')
    expect(typeof methods.runUpgrade).toBe('function')
    expect(typeof methods.prepareUpgrade).toBe('function')
  })
})
