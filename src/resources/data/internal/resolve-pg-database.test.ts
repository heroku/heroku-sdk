import type {AddOn, AddOnAttachment} from '@heroku/types/3.sdk'

import {
  describe, expect, it, vi,
} from 'vitest'

import type {ResourceCtx} from '../../../core/extend-resource.js'

import {resolvePgDatabase} from './resolve-pg-database.js'

function buildCtx({
  resolution,
  resolutionByAttachment,
}: {
  resolution?: ReturnType<typeof vi.fn>
  resolutionByAttachment?: ReturnType<typeof vi.fn>
}): ResourceCtx {
  return {
    data: {} as never,
    platform: {
      addOn: {resolution: resolution ?? vi.fn()},
      addOnAttachment: {resolution: resolutionByAttachment ?? vi.fn()},
    } as never,
  }
}

const addon = {app: {id: 'app-uuid', name: 'parent-app'}, id: 'addon-id', name: 'pg'} as AddOn

describe('resolvePgDatabase', () => {
  it('routes a parent::branch reference through addOn.resolution with parsed parts', async () => {
    const resolution = vi.fn().mockResolvedValue([addon])
    const ctx = buildCtx({resolution})

    const result = await resolvePgDatabase(ctx, {input: 'parent-app::branch'})

    expect(resolution).toHaveBeenCalledWith({addon: 'branch', app: 'parent-app'})
    expect(result.id).toBe('addon-id')
  })

  it('routes a SHOUTY_SNAKE_CASE input through addOnAttachment.resolution', async () => {
    const resolutionByAttachment = vi.fn().mockResolvedValue([
      {addon: {app: {id: 'app-uuid-1', name: 'app-1'}, id: 'addon-13', name: 'pg-attached'}} as AddOnAttachment,
    ])
    const ctx = buildCtx({resolutionByAttachment})

    const result = await resolvePgDatabase(ctx, {appIdentity: 'app-1', input: 'HEROKU_POSTGRESQL_GREEN'})

    expect(resolutionByAttachment).toHaveBeenCalledWith({
      // eslint-disable-next-line camelcase
      addon_attachment: 'HEROKU_POSTGRESQL_GREEN',
      app: 'app-1',
    })
    expect(result.id).toBe('addon-13')
  })

  it('routes a kebab-case input through addOn.resolution as an add-on identity', async () => {
    const resolution = vi.fn().mockResolvedValue([addon])
    const ctx = buildCtx({resolution})

    await resolvePgDatabase(ctx, {appIdentity: 'app-1', input: 'postgres-curved-12345'})

    expect(resolution).toHaveBeenCalledWith({addon: 'postgres-curved-12345', app: 'app-1'})
  })

  it('defaults to the DATABASE_URL attachment when input is omitted', async () => {
    const resolutionByAttachment = vi.fn().mockResolvedValue([
      {addon: {app: {id: 'app-uuid-1', name: 'app-1'}, id: 'addon-15', name: 'pg'}} as AddOnAttachment,
    ])
    const ctx = buildCtx({resolutionByAttachment})

    await resolvePgDatabase(ctx, {appIdentity: 'app-1'})

    expect(resolutionByAttachment).toHaveBeenCalledWith({
      // eslint-disable-next-line camelcase
      addon_attachment: 'DATABASE_URL',
      app: 'app-1',
    })
  })

  it('throws when input is omitted and no appIdentity is provided', async () => {
    const ctx = buildCtx({})
    await expect(resolvePgDatabase(ctx, {})).rejects.toThrow(/requires either input or appIdentity/)
  })
})
