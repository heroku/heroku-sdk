import type {AddOnAttachment} from '@heroku/types/3.sdk'

import {
  describe, expect, it, vi,
} from 'vitest'

import type {ResourceCtx} from '../../core/extend-resource.js'

import {listCredentials, postgresDatabaseExtensions} from './postgres-database.js'

function buildCtx(
  resolutionByAttachment: ReturnType<typeof vi.fn>,
  list: ReturnType<typeof vi.fn>,
): ResourceCtx {
  return {
    data: {
      postgresDatabase: {listCredentials: list},
    } as never,
    platform: {
      addOn: {resolution: vi.fn()},
      addOnAttachment: {resolution: resolutionByAttachment},
    } as never,
  }
}

describe('postgres-database resource', () => {
  it('listCredentials resolves the addon and calls postgresDatabase.listCredentials', async () => {
    const resolutionByAttachment = vi.fn().mockResolvedValue([
      {addon: {app: {id: 'app-uuid', name: 'app-1'}, id: 'addon-x', name: 'pg-attached'}} as AddOnAttachment,
    ])
    const list = vi.fn().mockResolvedValue([{name: 'default', state: 'created'}])

    const result = await listCredentials(buildCtx(resolutionByAttachment, list), 'app-1', 'DATABASE_URL')

    expect(list).toHaveBeenCalledWith('addon-x')
    expect(result).toEqual([{name: 'default', state: 'created'}])
  })

  it('postgresDatabaseExtensions declares service: data, resource: postgresDatabase', () => {
    expect(postgresDatabaseExtensions.service).toBe('data')
    expect(postgresDatabaseExtensions.resource).toBe('postgresDatabase')
  })
})
