import type {AddOnAttachment} from '@heroku/types/3.sdk'

import {
  describe, expect, it, vi,
} from 'vitest'

import type {ResourceCtx} from '../../core/extend-resource.js'

import {info, maintenanceExtensions} from './maintenance.js'

describe('maintenance resource', () => {
  it('info resolves the addon and calls maintenance.info', async () => {
    const resolution = vi.fn().mockResolvedValue([{addon: {id: 'addon-y'}}] as AddOnAttachment[])
    const maintenanceInfo = vi.fn().mockResolvedValue({state: 'scheduled'})
    const ctx: ResourceCtx = {
      data: {maintenance: {info: maintenanceInfo}} as never,
      platform: {addOnAttachment: {resolution}} as never,
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
