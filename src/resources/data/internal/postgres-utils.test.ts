import type {AddOn} from '@heroku/types/3.sdk'

import {
  afterEach, describe, expect, it, vi,
} from 'vitest'

import type {ResourceCtx} from '../../../core/extend-resource.js'

import {
  findLegacyDatabase, getPostgresServiceName, isAdvancedDatabase, isLegacyDatabase, isPostgresAddonInternal,
} from './postgres-utils.js'

function buildCtx(listByApp: ReturnType<typeof vi.fn>): Pick<ResourceCtx, 'platform'> {
  return {
    platform: {
      addOn: {listByApp},
    } as never,
  }
}

function addon(planName?: string, overrides: Partial<AddOn> = {}): AddOn {
  return {
    app: {id: 'app-uuid', name: 'app-1'},
    id: 'addon-id',
    name: 'pg',
    plan: planName ? {name: planName} : undefined,
    ...overrides,
  } as AddOn
}

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('getPostgresServiceName', () => {
  it('defaults to heroku-postgresql', () => {
    expect(getPostgresServiceName()).toBe('heroku-postgresql')
  })

  it('prefers HEROKU_POSTGRESQL_ADDON_NAME', () => {
    vi.stubEnv('HEROKU_POSTGRESQL_ADDON_NAME', 'heroku-postgresql-dev')
    vi.stubEnv('HEROKU_DATA_SERVICE', 'other')

    expect(getPostgresServiceName()).toBe('heroku-postgresql-dev')
  })

  it('falls back to HEROKU_DATA_SERVICE', () => {
    vi.stubEnv('HEROKU_DATA_SERVICE', 'heroku-postgresql-staging')

    expect(getPostgresServiceName()).toBe('heroku-postgresql-staging')
  })
})

describe('plan classification', () => {
  it('treats essential plans as legacy postgres', () => {
    const candidate = addon('heroku-postgresql:essential-0')

    expect(isPostgresAddonInternal(candidate)).toBe(true)
    expect(isAdvancedDatabase(candidate)).toBe(false)
    expect(isLegacyDatabase(candidate)).toBe(true)
  })

  it('treats standard plans as legacy postgres', () => {
    const candidate = addon('heroku-postgresql:standard-0')

    expect(isPostgresAddonInternal(candidate)).toBe(true)
    expect(isAdvancedDatabase(candidate)).toBe(false)
    expect(isLegacyDatabase(candidate)).toBe(true)
  })

  it('treats advanced plans as advanced postgres', () => {
    const candidate = addon('heroku-postgresql:advanced-0')

    expect(isPostgresAddonInternal(candidate)).toBe(true)
    expect(isAdvancedDatabase(candidate)).toBe(true)
    expect(isLegacyDatabase(candidate)).toBe(false)
  })

  it('treats performance plans as advanced postgres', () => {
    const candidate = addon('heroku-postgresql:performance-l')

    expect(isPostgresAddonInternal(candidate)).toBe(true)
    expect(isAdvancedDatabase(candidate)).toBe(true)
    expect(isLegacyDatabase(candidate)).toBe(false)
  })

  it('does not treat redis plans as postgres', () => {
    const candidate = addon('heroku-redis:premium-0')

    expect(isPostgresAddonInternal(candidate)).toBe(false)
    expect(isAdvancedDatabase(candidate)).toBe(false)
    expect(isLegacyDatabase(candidate)).toBe(false)
  })

  it('treats a missing plan as not postgres', () => {
    const candidate = addon()

    expect(isPostgresAddonInternal(candidate)).toBe(false)
    expect(isAdvancedDatabase(candidate)).toBe(false)
    expect(isLegacyDatabase(candidate)).toBe(false)
  })
})

describe('findLegacyDatabase', () => {
  it('returns the first legacy database on the app', async () => {
    const listByApp = vi.fn().mockResolvedValue([
      addon('heroku-redis:premium-0', {id: 'redis-id'}),
      addon('heroku-postgresql:performance-l', {id: 'perf-id'}),
      addon('heroku-postgresql:essential-0', {app: {id: 'other-uuid', name: 'other-app'}, id: 'other-app-id'}),
      addon('heroku-postgresql:essential-0', {id: 'legacy-id'}),
      addon('heroku-postgresql:standard-0', {id: 'later-legacy-id'}),
    ])

    const result = await findLegacyDatabase(buildCtx(listByApp), 'app-1')

    expect(listByApp).toHaveBeenCalledWith('app-1')
    expect(result.id).toBe('legacy-id')
  })

  it('throws when the app has no legacy postgres database', async () => {
    const listByApp = vi.fn().mockResolvedValue([
      addon('heroku-postgresql:advanced-0'),
    ])

    await expect(findLegacyDatabase(buildCtx(listByApp), 'app-1'))
      .rejects.toThrow('No Heroku Postgres legacy database on app-1')
  })
})
