import {
  describe, expect, it, vi,
} from 'vitest'

import type {ResourceCtx} from '../../core/extend-resource.js'

import {info, maintenanceExtensions} from './maintenance.js'

describe('maintenance resource', () => {
  it('info resolves the addon and calls maintenance.info', async () => {
    const resolutionByAttachment = vi.fn().mockResolvedValue([
      {
        addon: {
          app: {id: 'app-uuid', name: 'app-1'},
          id: 'addon-y',
          name: 'pg-attached',
          plan: {name: 'heroku-postgresql:essential-0'},
        },
        app: {id: 'app-uuid', name: 'app-1'},
        id: 'attachment-id',
        name: 'DATABASE',
      },
    ])
    const maintenanceInfo = vi.fn().mockResolvedValue({state: 'scheduled'})
    const ctx: ResourceCtx = {
      data: {maintenance: {info: maintenanceInfo}} as never,
      platform: {
        addOnAttachment: {resolution: resolutionByAttachment},
        withHeaders() {
          return this
        },
        withOptions() {
          return this
        },
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
