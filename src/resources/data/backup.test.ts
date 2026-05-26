import type {AddOnAttachment} from '@heroku/types/3.sdk'

import {
  describe, expect, it, vi,
} from 'vitest'

import type {ResourceCtx} from '../../core/extend-resource.js'

import {backupExtensions, create} from './backup.js'

function buildCtx(opts: {
  backupCreate?: ReturnType<typeof vi.fn>
  resolution?: ReturnType<typeof vi.fn>
  resolutionByAttachment?: ReturnType<typeof vi.fn>
}): ResourceCtx {
  return {
    data: {
      backup: {
        create: opts.backupCreate ?? vi.fn(),
      },
    } as never,
    platform: {
      addOn: {resolution: opts.resolution ?? vi.fn()},
      addOnAttachment: {resolution: opts.resolutionByAttachment ?? vi.fn()},
    } as never,
  }
}

const oneAttachmentMatch = [
  {addon: {app: {id: 'app-uuid', name: 'app-1'}, id: 'addon-1', name: 'pg-attached'}} as AddOnAttachment,
]

describe('backup resource', () => {
  it('create resolves the addon and calls backup.create', async () => {
    const resolutionByAttachment = vi.fn().mockResolvedValue(oneAttachmentMatch)
    const backupCreate = vi.fn().mockResolvedValue({uuid: 'backup-uuid', from_type: 'pg_dump', to_type: 'gof3r'})
    const ctx = buildCtx({backupCreate, resolutionByAttachment})

    const result = await create(ctx, 'app-1', 'DATABASE_URL')

    expect(resolutionByAttachment).toHaveBeenCalledWith({
      // eslint-disable-next-line camelcase
      addon_attachment: 'DATABASE_URL',
      app: 'app-1',
    })
    expect(backupCreate).toHaveBeenCalledWith('addon-1')
    expect(result).toEqual({uuid: 'backup-uuid', from_type: 'pg_dump', to_type: 'gof3r'})
  })

  it('create defaults to DATABASE_URL attachment when no addonIdentity is given', async () => {
    const resolutionByAttachment = vi.fn().mockResolvedValue(oneAttachmentMatch)
    const backupCreate = vi.fn().mockResolvedValue({})
    const ctx = buildCtx({backupCreate, resolutionByAttachment})

    await create(ctx, 'app-1')

    expect(resolutionByAttachment).toHaveBeenCalledWith({
      // eslint-disable-next-line camelcase
      addon_attachment: 'DATABASE_URL',
      app: 'app-1',
    })
  })

  it('create throws if signal is aborted', async () => {
    const ctx = buildCtx({})
    const controller = new AbortController()
    controller.abort()

    await expect(create(ctx, 'app-1', undefined, {signal: controller.signal})).rejects.toThrow()
  })

  it('backupExtensions declares service: data, resource: backup', () => {
    expect(backupExtensions.service).toBe('data')
    expect(backupExtensions.resource).toBe('backup')
  })

  it('backupExtensions factory exposes create', () => {
    const methods = backupExtensions.factory(buildCtx({}))
    expect(typeof methods.create).toBe('function')
  })
})
