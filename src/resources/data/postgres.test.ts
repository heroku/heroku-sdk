import type {AddOnAttachment} from '@heroku/types/3.sdk'

import {
  describe, expect, it, vi,
} from 'vitest'

import type {ResourceCtx} from '../../core/extend-resource.js'

import {info, postgresExtensions} from './postgres.js'

function buildCtx(opts: {
  postgresInfo?: ReturnType<typeof vi.fn>
  resolution?: ReturnType<typeof vi.fn>
  resolutionByAttachment?: ReturnType<typeof vi.fn>
}): ResourceCtx {
  return {
    data: {
      postgres: {
        info: opts.postgresInfo ?? vi.fn(),
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

describe('postgres resource', () => {
  it('info resolves the addon by attachment and calls postgres.info', async () => {
    const resolutionByAttachment = vi.fn().mockResolvedValue(oneAttachmentMatch)
    const postgresInfo = vi.fn().mockResolvedValue({version: '16', status: 'available'})
    const ctx = buildCtx({postgresInfo, resolutionByAttachment})

    const result = await info(ctx, 'app-1', 'HEROKU_POSTGRESQL_BLUE')

    expect(resolutionByAttachment).toHaveBeenCalledWith({
      // eslint-disable-next-line camelcase
      addon_attachment: 'HEROKU_POSTGRESQL_BLUE',
      app: 'app-1',
    })
    expect(postgresInfo).toHaveBeenCalledWith('addon-1')
    expect(result).toEqual({version: '16', status: 'available'})
  })

  it('info defaults to the DATABASE_URL attachment when no addonIdentity is given', async () => {
    const resolutionByAttachment = vi.fn().mockResolvedValue(oneAttachmentMatch)
    const postgresInfo = vi.fn().mockResolvedValue({})
    const ctx = buildCtx({postgresInfo, resolutionByAttachment})

    await info(ctx, 'app-1')

    expect(resolutionByAttachment).toHaveBeenCalledWith({
      // eslint-disable-next-line camelcase
      addon_attachment: 'DATABASE_URL',
      app: 'app-1',
    })
  })

  it('info throws if signal is aborted', async () => {
    const ctx = buildCtx({})
    const controller = new AbortController()
    controller.abort()

    await expect(info(ctx, 'app-1', undefined, {signal: controller.signal})).rejects.toThrow()
  })

  it('postgresExtensions declares service: data, resource: postgres', () => {
    expect(postgresExtensions.service).toBe('data')
    expect(postgresExtensions.resource).toBe('postgres')
  })

  it('postgresExtensions factory exposes info', () => {
    const methods = postgresExtensions.factory(buildCtx({}))
    expect(typeof methods.info).toBe('function')
  })
})
