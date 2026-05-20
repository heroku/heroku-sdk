import type {AddOnAttachment} from '@heroku/types/3.sdk'

import {
  describe, expect, it, vi,
} from 'vitest'

import type {ResourceCtx} from '../../core/extend-resource.js'

import {info, maintenanceExtensions} from './maintenance.js'

describe('maintenance resource', () => {
  it('info resolves the addon and calls maintenance.info', async () => {
    const resolutionByAttachment = vi.fn().mockResolvedValue([
      {addon: {app: {id: 'app-uuid', name: 'app-1'}, id: 'addon-y', name: 'pg-attached'}} as AddOnAttachment,
    ])
    const maintenanceInfo = vi.fn().mockResolvedValue({state: 'scheduled'})
    const ctx: ResourceCtx = {
      data: {maintenance: {info: maintenanceInfo}} as never,
      platform: {
        addOn: {resolution: vi.fn()},
        addOnAttachment: {resolution: resolutionByAttachment},
      } as never,
    }

    const result = await info(ctx, 'app-1', 'DATABASE_URL')

    expect(maintenanceInfo).toHaveBeenCalledWith('addon-y')
    expect(result).toEqual({state: 'scheduled'})
  })

  it('maintenanceExtensions declares service: data, resource: maintenance', () => {
    expect(maintenanceExtensions.service).toBe('data')
    expect(maintenanceExtensions.resource).toBe('maintenance')
  })
})
