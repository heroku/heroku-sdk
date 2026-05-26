import type {AddOnAttachment} from '@heroku/types/3.sdk'

import {
  describe, expect, it, vi,
} from 'vitest'

import type {ResourceCtx} from '../../core/extend-resource.js'

import {list, transferScheduleExtensions} from './transfer-schedule.js'

function buildCtx(opts: {
  resolution?: ReturnType<typeof vi.fn>
  resolutionByAttachment?: ReturnType<typeof vi.fn>
  transferScheduleList?: ReturnType<typeof vi.fn>
}): ResourceCtx {
  return {
    data: {
      transferSchedule: {
        list: opts.transferScheduleList ?? vi.fn(),
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

describe('transfer-schedule resource', () => {
  it('list resolves the addon and calls transferSchedule.list', async () => {
    const resolutionByAttachment = vi.fn().mockResolvedValue(oneAttachmentMatch)
    const transferScheduleList = vi.fn().mockResolvedValue([{uuid: 'sched-1', hour: 2, timezone: 'UTC'}])
    const ctx = buildCtx({resolutionByAttachment, transferScheduleList})

    const result = await list(ctx, 'app-1', 'DATABASE_URL')

    expect(resolutionByAttachment).toHaveBeenCalledWith({
      // eslint-disable-next-line camelcase
      addon_attachment: 'DATABASE_URL',
      app: 'app-1',
    })
    expect(transferScheduleList).toHaveBeenCalledWith('addon-1')
    expect(result).toEqual([{uuid: 'sched-1', hour: 2, timezone: 'UTC'}])
  })

  it('list defaults to DATABASE_URL attachment when no addonIdentity is given', async () => {
    const resolutionByAttachment = vi.fn().mockResolvedValue(oneAttachmentMatch)
    const transferScheduleList = vi.fn().mockResolvedValue({})
    const ctx = buildCtx({resolutionByAttachment, transferScheduleList})

    await list(ctx, 'app-1')

    expect(resolutionByAttachment).toHaveBeenCalledWith({
      // eslint-disable-next-line camelcase
      addon_attachment: 'DATABASE_URL',
      app: 'app-1',
    })
  })

  it('list throws if signal is aborted', async () => {
    const ctx = buildCtx({})
    const controller = new AbortController()
    controller.abort()

    await expect(list(ctx, 'app-1', undefined, {signal: controller.signal})).rejects.toThrow()
  })

  it('transferScheduleExtensions declares service: data, resource: transferSchedule', () => {
    expect(transferScheduleExtensions.service).toBe('data')
    expect(transferScheduleExtensions.resource).toBe('transferSchedule')
  })

  it('transferScheduleExtensions factory exposes list', () => {
    const methods = transferScheduleExtensions.factory(buildCtx({}))
    expect(typeof methods.list).toBe('function')
  })
})
