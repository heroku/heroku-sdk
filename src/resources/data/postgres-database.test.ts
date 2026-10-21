import {
  describe, expect, it, vi,
} from 'vitest'

import type {ResourceCtx} from '../../core/extend-resource.js'

import {listCredentials, postgresDatabaseExtensions} from './postgres-database.js'

function buildCtx(
  resolutionByAttachment: ReturnType<typeof vi.fn>,
  list: ReturnType<typeof vi.fn>,
): ResourceCtx {
  const data: Record<string, unknown> = {
    postgresDatabase: {listCredentials: list},
  }
  // Self-referential so a `.withOptions({signal})` chain resolves back to data.
  data.withOptions = vi.fn(() => data)

  return {
    data: data as never,
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
}

describe('postgres-database resource', () => {
  it('listCredentials resolves the addon and calls postgresDatabase.listCredentials', async () => {
    const resolutionByAttachment = vi.fn().mockResolvedValue([
      {
        addon: {
          app: {id: 'app-uuid', name: 'app-1'},
          id: 'addon-x',
          name: 'pg-attached',
          plan: {name: 'heroku-postgresql:essential-0'},
        },
        app: {id: 'app-uuid', name: 'app-1'},
        id: 'attachment-id',
        name: 'DATABASE',
      },
    ])
    const list = vi.fn().mockResolvedValue([{name: 'default', state: 'created'}])

    const result = await listCredentials(buildCtx(resolutionByAttachment, list), 'app-1', 'DATABASE_URL')

    expect(list).toHaveBeenCalledWith('addon-x')
    expect(result).toEqual([{name: 'default', state: 'created'}])
  })

  it('binds the signal to the data client so the request aborts in flight', async () => {
    const resolutionByAttachment = vi.fn().mockResolvedValue([
      {
        addon: {
          app: {id: 'app-uuid', name: 'app-1'}, id: 'addon-x', name: 'pg-attached', plan: {name: 'heroku-postgresql:essential-0'},
        },
        app: {id: 'app-uuid', name: 'app-1'},
        id: 'attachment-id',
        name: 'DATABASE',
      },
    ])
    const list = vi.fn().mockResolvedValue([])
    const ctx = buildCtx(resolutionByAttachment, list)
    const controller = new AbortController()

    await listCredentials(ctx, 'app-1', 'DATABASE_URL', {signal: controller.signal})

    expect((ctx.data as unknown as {withOptions: ReturnType<typeof vi.fn>}).withOptions)
      .toHaveBeenCalledWith({signal: controller.signal})
  })

  it('postgresDatabaseExtensions declares service: data, resource: postgresDatabase', () => {
    expect(postgresDatabaseExtensions.service).toBe('data')
    expect(postgresDatabaseExtensions.resource).toBe('postgresDatabase')
  })
})
