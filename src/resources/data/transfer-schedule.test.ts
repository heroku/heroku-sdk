/* eslint-disable camelcase */
import {
  describe, expect, it, vi,
} from 'vitest'

import type {ResourceCtx} from '../../core/extend-resource.js'

import {legacyResourceCtx} from '../../../test-types/heroku-sdk-options.js'
import {
  create, del, list, transferScheduleExtensions,
} from './transfer-schedule.js'

function buildCtx(opts: {
  addonListByApp?: ReturnType<typeof vi.fn>
  create?: ReturnType<typeof vi.fn>
  delete?: ReturnType<typeof vi.fn>
  list?: ReturnType<typeof vi.fn>
  resolutionByAttachment?: ReturnType<typeof vi.fn>
}): ResourceCtx {
  return {
    ...legacyResourceCtx,
    data: {
      transferSchedule: {
        create: opts.create ?? vi.fn(),
        delete: opts.delete ?? vi.fn(),
        list: opts.list ?? vi.fn(),
      },
    } as never,
    platform: {
      addOn: {listByApp: opts.addonListByApp ?? vi.fn()},
      addOnAttachment: {resolution: opts.resolutionByAttachment ?? vi.fn()},
      withHeaders() {
        return this
      },
      withOptions() {
        return this
      },
    } as never,
  }
}

const legacyAddon = {
  app: {id: 'app-uuid', name: 'app-1'},
  id: 'addon-1',
  name: 'postgresql-legacy',
  plan: {name: 'heroku-postgresql:essential-0'},
}

const attachmentMatch = [
  {
    addon: {
      app: {id: 'app-uuid', name: 'app-1'},
      id: 'addon-1',
      name: 'pg-attached',
      plan: {name: 'heroku-postgresql:essential-0'},
    },
    app: {id: 'app-uuid', name: 'app-1'},
    id: 'attachment-id',
    name: 'DATABASE',
  },
]

describe('transferSchedule resource', () => {
  it('list resolves a legacy addon and calls transferSchedule.list', async () => {
    const addonListByApp = vi.fn().mockResolvedValue([legacyAddon])
    const schedules = [{
      hour: 4, name: 'DATABASE_URL', timezone: 'UTC', uuid: 'sched-1',
    }]
    const listStub = vi.fn().mockResolvedValue(schedules)
    const ctx = buildCtx({addonListByApp, list: listStub})

    const result = await list(ctx, 'app-1')

    expect(addonListByApp).toHaveBeenCalledWith('app-1')
    expect(listStub).toHaveBeenCalledWith('addon-1')
    expect(result).toEqual(schedules)
  })

  it('create resolves the addon and calls transferSchedule.create with the body', async () => {
    const resolutionByAttachment = vi.fn().mockResolvedValue(attachmentMatch)
    const createStub = vi.fn().mockResolvedValue({hour: 4, name: 'DATABASE_URL', uuid: 'sched-1'})
    const ctx = buildCtx({create: createStub, resolutionByAttachment})

    const result = await create(ctx, 'app-1', 'DATABASE_URL', {hour: 4, schedule_name: 'DATABASE_URL', timezone: 'UTC'})

    expect(createStub).toHaveBeenCalledWith('addon-1', {hour: 4, schedule_name: 'DATABASE_URL', timezone: 'UTC'})
    expect(result).toEqual({hour: 4, name: 'DATABASE_URL', uuid: 'sched-1'})
  })

  it('create defaults schedule_name from the attachment name', async () => {
    const resolutionByAttachment = vi.fn().mockResolvedValue(attachmentMatch)
    const createStub = vi.fn().mockResolvedValue({hour: 4, name: 'DATABASE_URL', uuid: 'sched-1'})
    const ctx = buildCtx({create: createStub, resolutionByAttachment})

    await create(ctx, 'app-1', 'DATABASE_URL', {hour: 4, timezone: 'UTC'})

    expect(createStub).toHaveBeenCalledWith('addon-1', {hour: 4, schedule_name: 'DATABASE_URL', timezone: 'UTC'})
  })

  it('delete resolves the addon and calls transferSchedule.delete with the schedule id', async () => {
    const resolutionByAttachment = vi.fn().mockResolvedValue(attachmentMatch)
    const deleteStub = vi.fn().mockResolvedValue({name: 'DATABASE_URL', uuid: 'sched-1'})
    const ctx = buildCtx({delete: deleteStub, resolutionByAttachment})

    const result = await del(ctx, 'app-1', 'DATABASE_URL', 'sched-1')

    expect(deleteStub).toHaveBeenCalledWith('addon-1', 'sched-1')
    expect(result).toEqual({name: 'DATABASE_URL', uuid: 'sched-1'})
  })

  it('transferScheduleExtensions declares service: data, resource: transferSchedule', () => {
    expect(transferScheduleExtensions.service).toBe('data')
    expect(transferScheduleExtensions.resource).toBe('transferSchedule')
  })
})
