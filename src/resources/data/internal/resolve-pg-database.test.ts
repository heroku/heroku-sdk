import type {AddOn} from '@heroku/types/3.sdk'

import {
  describe, expect, it, vi,
} from 'vitest'

import type {ResourceCtx} from '../../../core/extend-resource.js'

import {resolvePgDatabase} from './resolve-pg-database.js'

function buildCtx(resolution: ReturnType<typeof vi.fn>): ResourceCtx {
  return {
    data: {} as never,
    platform: {addOn: {resolution}} as never,
  }
}

function pgAddon(overrides: Partial<AddOn> = {}): AddOn {
  return {
    // eslint-disable-next-line camelcase
    addon_service: {id: 'service-id', name: 'heroku-postgresql'},
    app: {id: 'app-uuid', name: 'parent-app'},
    id: 'addon-id',
    name: 'pg',
    ...overrides,
  } as AddOn
}

describe('resolvePgDatabase', () => {
  it('routes a parent::branch reference through addOn.resolution with parsed parts', async () => {
    const resolution = vi.fn().mockResolvedValue([pgAddon()])
    const ctx = buildCtx(resolution)

    const result = await resolvePgDatabase(ctx, {input: 'parent-app::branch'})

    expect(resolution).toHaveBeenCalledWith({addon: 'branch', app: 'parent-app'})
    expect(result.id).toBe('addon-id')
  })

  it('defaults to the DATABASE_URL attachment when input is omitted', async () => {
    const resolution = vi.fn().mockResolvedValue([pgAddon()])
    const ctx = buildCtx(resolution)

    const result = await resolvePgDatabase(ctx, {appIdentity: 'app-1'})

    expect(resolution).toHaveBeenCalledWith({addon: 'DATABASE_URL', app: 'app-1'})
    expect(result.id).toBe('addon-id')
  })

  it('routes a SHOUTY_SNAKE_CASE config var input through addOn.resolution scoped to the app', async () => {
    const resolution = vi.fn().mockResolvedValue([pgAddon({id: 'addon-13'})])
    const ctx = buildCtx(resolution)

    const result = await resolvePgDatabase(ctx, {appIdentity: 'app-1', input: 'HEROKU_POSTGRESQL_GREEN'})

    expect(resolution).toHaveBeenCalledWith({addon: 'HEROKU_POSTGRESQL_GREEN', app: 'app-1'})
    expect(result.id).toBe('addon-13')
  })

  it('routes a kebab-case global add-on name through addOn.resolution', async () => {
    const resolution = vi.fn().mockResolvedValue([pgAddon()])
    const ctx = buildCtx(resolution)

    await resolvePgDatabase(ctx, {appIdentity: 'app-1', input: 'postgres-curved-12345'})

    expect(resolution).toHaveBeenCalledWith({addon: 'postgres-curved-12345', app: 'app-1'})
  })

  it('resolves globally when no appIdentity is given and the input has no app context', async () => {
    const resolution = vi.fn().mockResolvedValue([pgAddon()])
    const ctx = buildCtx(resolution)

    await resolvePgDatabase(ctx, {input: 'postgres-curved-12345'})

    expect(resolution).toHaveBeenCalledWith({addon: 'postgres-curved-12345'})
  })

  it('throws when a match is found but its addon service is not heroku-postgresql', async () => {
    // eslint-disable-next-line camelcase
    const resolution = vi.fn().mockResolvedValue([pgAddon({addon_service: {id: 'other', name: 'heroku-redis'}})])
    const ctx = buildCtx(resolution)

    await expect(resolvePgDatabase(ctx, {appIdentity: 'app-1'})).rejects.toThrow()
  })

  it('throws when input is omitted and no appIdentity is provided', async () => {
    const ctx = buildCtx(vi.fn())
    await expect(resolvePgDatabase(ctx, {})).rejects.toThrow(/requires either input or appIdentity/)
  })
})
