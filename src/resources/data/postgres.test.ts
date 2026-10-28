import {
  describe, expect, it, vi,
} from 'vitest'

import type {ResourceCtx} from '../../core/extend-resource.js'

import {NotAdvancedDatabaseError} from './internal/postgres-utils.js'
import {postgresExtensions, runUpgrade} from './postgres.js'

function buildCtx(opts: {
  postgresInfo?: ReturnType<typeof vi.fn>
  resolutionByAttachment?: ReturnType<typeof vi.fn>
  runUpgrade?: ReturnType<typeof vi.fn>
} = {}): Pick<ResourceCtx, 'data' | 'platform'> {
  const dataClient = {
    postgres: {
      info: opts.postgresInfo ?? vi.fn().mockResolvedValue({version: '16.10'}),
      runUpgrade: opts.runUpgrade ?? vi.fn(),
    },
    withOptions: vi.fn(() => dataClient),
  }

  return {
    data: dataClient as never,
    platform: {
      addOnAttachment: {
        resolution: opts.resolutionByAttachment ?? vi.fn(),
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

function buildAttachmentMatch(opts: {addonId?: string; addonName?: string; planName: string}) {
  return [
    {
      addon: {
        app: {id: 'app-uuid', name: 'app-1'},
        id: opts.addonId ?? 'addon-1',
        name: opts.addonName ?? 'pg-addon',
        plan: {name: opts.planName},
      },
      app: {id: 'app-uuid', name: 'app-1'},
      id: 'attachment-1',
      name: 'DATABASE',
    },
  ]
}

describe('postgres resource', () => {
  it('postgresExtensions declares service: data, resource: postgres', () => {
    expect(postgresExtensions.service).toBe('data')
    expect(postgresExtensions.resource).toBe('postgres')
  })

  describe('runUpgrade', () => {
    it('resolves the database by attachment and runs the upgrade on an Advanced-tier database', async () => {
      const resolutionByAttachment = vi.fn().mockResolvedValue(buildAttachmentMatch({addonId: 'addon-1', addonName: 'pg-addon', planName: 'heroku-postgresql:advanced-0'}))
      const runUpgradeMock = vi.fn().mockResolvedValue({message: 'upgrading'})
      const ctx = buildCtx({resolutionByAttachment, runUpgrade: runUpgradeMock})

      const {addon, result} = await runUpgrade(ctx, 'app-1', 'DATABASE_URL', {version: '17'})

      expect(resolutionByAttachment).toHaveBeenCalledWith({
        // eslint-disable-next-line camelcase
        addon_attachment: 'DATABASE_URL',
        app: 'app-1',
      })
      expect(runUpgradeMock).toHaveBeenCalledWith('addon-1', {version: '17'})
      expect(addon.id).toBe('addon-1')
      expect(result).toEqual({message: 'upgrading'})
    })

    it('throws NotAdvancedDatabaseError with the resolved database for classic-tier databases', async () => {
      const resolutionByAttachment = vi.fn().mockResolvedValue(buildAttachmentMatch({addonId: 'addon-1', planName: 'heroku-postgresql:standard-0'}))
      const runUpgradeMock = vi.fn()
      const ctx = buildCtx({resolutionByAttachment, runUpgrade: runUpgradeMock})

      const error = await runUpgrade(ctx, 'app-1', 'DATABASE_URL').catch((error_: unknown) => error_)

      expect(error).toBeInstanceOf(NotAdvancedDatabaseError)
      expect((error as NotAdvancedDatabaseError).addon.id).toBe('addon-1')
      expect(runUpgradeMock).not.toHaveBeenCalled()
    })

    it('throws if signal is aborted', async () => {
      const ctx = buildCtx()
      const controller = new AbortController()
      controller.abort()

      await expect(runUpgrade(ctx, 'app-1', 'DATABASE_URL', {}, {signal: controller.signal})).rejects.toThrow()
    })

    it('runs beforeRunUpgrade with the resolved addon and current version before upgrading', async () => {
      const resolutionByAttachment = vi.fn().mockResolvedValue(buildAttachmentMatch({addonId: 'addon-1', planName: 'heroku-postgresql:advanced-0'}))
      const calls: string[] = []
      const postgresInfo = vi.fn(async () => {
        calls.push('info')
        return {version: '16.10'}
      })
      const runUpgradeMock = vi.fn(async () => {
        calls.push('runUpgrade')
        return {message: 'upgrading'}
      })
      const ctx = buildCtx({postgresInfo, resolutionByAttachment, runUpgrade: runUpgradeMock})
      const beforeRunUpgrade = vi.fn(() => {
        calls.push('beforeRunUpgrade')
      })

      await runUpgrade(ctx, 'app-1', 'DATABASE_URL', {}, {beforeRunUpgrade})

      expect(beforeRunUpgrade).toHaveBeenCalledWith({
        addon: expect.objectContaining({id: 'addon-1'}),
        currentVersion: '16.10',
      })
      expect(calls).toEqual(['info', 'beforeRunUpgrade', 'runUpgrade'])
    })

    it('does not run the upgrade if beforeRunUpgrade rejects', async () => {
      const resolutionByAttachment = vi.fn().mockResolvedValue(buildAttachmentMatch({addonId: 'addon-1', planName: 'heroku-postgresql:advanced-0'}))
      const runUpgradeMock = vi.fn()
      const ctx = buildCtx({resolutionByAttachment, runUpgrade: runUpgradeMock})
      const beforeRunUpgrade = vi.fn().mockRejectedValue(new Error('user declined'))

      await expect(runUpgrade(ctx, 'app-1', 'DATABASE_URL', {}, {beforeRunUpgrade})).rejects.toThrow('user declined')
      expect(runUpgradeMock).not.toHaveBeenCalled()
    })

    it('does not run the upgrade if the signal aborts inside beforeRunUpgrade', async () => {
      const resolutionByAttachment = vi.fn().mockResolvedValue(buildAttachmentMatch({addonId: 'addon-1', planName: 'heroku-postgresql:advanced-0'}))
      const runUpgradeMock = vi.fn()
      const ctx = buildCtx({resolutionByAttachment, runUpgrade: runUpgradeMock})
      const controller = new AbortController()
      const beforeRunUpgrade = vi.fn(() => controller.abort())

      await expect(runUpgrade(ctx, 'app-1', 'DATABASE_URL', {}, {beforeRunUpgrade, signal: controller.signal})).rejects.toThrow()
      expect(runUpgradeMock).not.toHaveBeenCalled()
    })
  })
})
