import type {AddOn} from '@heroku/types/3.sdk'

import {
  describe, expect, it, vi,
} from 'vitest'

import type {ResourceCtx} from '../../../core/extend-resource.js'

import {AddonAmbiguousError, AddonNotFoundError} from '../../platform/add-on/index.js'
import {RedisAddonAmbiguousError, RedisAddonNotFoundError} from './errors.js'
import {resolveRedisByApp} from './resolve-by-app.js'

function buildCtx(listByApp: ReturnType<typeof vi.fn>): ResourceCtx {
  return {
    data: {} as never,
    platform: {
      addOn: {listByApp},
    } as never,
  }
}

const redisAddon = (overrides: Partial<AddOn> = {}): AddOn => ({
  // eslint-disable-next-line camelcase
  addon_service: {name: 'heroku-redis'},
  app: {id: 'app-uuid', name: 'my-app'},
  // eslint-disable-next-line camelcase
  config_vars: ['REDIS_URL'],
  id: 'addon-id',
  name: 'redis-alpha-1',
  ...overrides,
} as AddOn)

describe('resolveRedisByApp', () => {
  it('returns the single matching redis add-on', async () => {
    const addon = redisAddon()
    const list = vi.fn().mockResolvedValue([addon])
    const ctx = buildCtx(list)

    const result = await resolveRedisByApp(ctx, 'my-app')

    expect(list).toHaveBeenCalledWith('my-app')
    expect(result.id).toBe('addon-id')
  })

  it('filters out non-redis add-ons', async () => {
    const pg = redisAddon({
      // eslint-disable-next-line camelcase
      addon_service: {name: 'heroku-postgresql'}, id: 'pg-1', name: 'pg-blue-1',
    })
    const redis = redisAddon()
    const list = vi.fn().mockResolvedValue([pg, redis])
    const ctx = buildCtx(list)

    const result = await resolveRedisByApp(ctx, 'my-app')

    expect(result.id).toBe('addon-id')
  })

  it('throws RedisAddonNotFoundError when zero add-ons match', async () => {
    const list = vi.fn().mockResolvedValue([])
    const ctx = buildCtx(list)

    const error = await resolveRedisByApp(ctx, 'my-app').catch((e: unknown) => e)
    expect(error).toBeInstanceOf(RedisAddonNotFoundError)
    expect(error).toBeInstanceOf(AddonNotFoundError)
    expect((error as Error).message).toBe('No Redis instances found.')
  })

  it('throws RedisAddonAmbiguousError when more than one add-on matches', async () => {
    const a = redisAddon({id: 'a', name: 'redis-a'})
    const b = redisAddon({id: 'b', name: 'redis-b'})
    const list = vi.fn().mockResolvedValue([a, b])
    const ctx = buildCtx(list)

    const error = await resolveRedisByApp(ctx, 'my-app').catch((e: unknown) => e)
    expect(error).toBeInstanceOf(RedisAddonAmbiguousError)
    expect(error).toBeInstanceOf(AddonAmbiguousError)
    expect((error as Error).message).toBe('Please specify a single instance. Found: redis-a, redis-b')
  })

  it('narrows via the database filter by add-on name substring (case-insensitive)', async () => {
    const alpha = redisAddon({id: 'a', name: 'redis-alpha-1'})
    const beta = redisAddon({id: 'b', name: 'redis-beta-2'})
    const list = vi.fn().mockResolvedValue([alpha, beta])
    const ctx = buildCtx(list)

    const result = await resolveRedisByApp(ctx, 'my-app', {database: 'alpha'})

    expect(result.id).toBe('a')
  })

  it('narrows via the database filter by config-var substring', async () => {
    const primary = redisAddon({
      // eslint-disable-next-line camelcase
      config_vars: ['REDIS_URL'], id: 'a', name: 'redis-primary',
    })
    const cache = redisAddon({
      // eslint-disable-next-line camelcase
      config_vars: ['HEROKU_REDIS_CACHE_URL'], id: 'b', name: 'redis-cache',
    })
    const list = vi.fn().mockResolvedValue([primary, cache])
    const ctx = buildCtx(list)

    const result = await resolveRedisByApp(ctx, 'my-app', {database: 'cache'})

    expect(result.id).toBe('b')
  })

  it('throws RedisAddonNotFoundError when the database filter matches nothing', async () => {
    const list = vi.fn().mockResolvedValue([redisAddon()])
    const ctx = buildCtx(list)

    await expect(resolveRedisByApp(ctx, 'my-app', {database: 'nope'})).rejects.toBeInstanceOf(RedisAddonNotFoundError)
  })

  it('respects addonServiceName override for the addon_service prefix filter', async () => {
    const kv = redisAddon({
      // eslint-disable-next-line camelcase
      addon_service: {name: 'heroku-key-value-store'}, id: 'kv-1', name: 'kv-alpha',
    })
    const redis = redisAddon()
    const list = vi.fn().mockResolvedValue([kv, redis])
    const ctx = buildCtx(list)

    const result = await resolveRedisByApp(ctx, 'my-app', {addonServiceName: 'heroku-key-value-store'})

    expect(result.id).toBe('kv-1')
  })

  it('throws if the abort signal is already aborted', async () => {
    const list = vi.fn()
    const ctx = buildCtx(list)
    const controller = new AbortController()
    controller.abort()

    await expect(resolveRedisByApp(ctx, 'my-app', {signal: controller.signal})).rejects.toThrow()
    expect(list).not.toHaveBeenCalled()
  })
})
