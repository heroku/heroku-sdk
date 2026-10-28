import type {AddOn} from '@heroku/types/3.sdk'
import type {PostgresCredentialInfoResult as AdvancedCredentialInfo} from '@heroku/types/data'

import {
  afterEach, describe, expect, it, vi,
} from 'vitest'

import type {ResourceCtx} from '../../../core/extend-resource.js'
import type {CredentialInfo as NonAdvancedCredentialInfo} from '../postgres-database.js'

import {
  findLegacyDatabase,
  getPostgresServiceName,
  isAdvancedCredential,
  isAdvancedDatabase,
  isEssentialDatabase,
  isEssentialTier,
  isLegacyDatabase,
  isLegacyEssentialDatabase,
  isPostgresAddon,
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

function classify(planName?: string) {
  const candidate = addon(planName)
  return {
    advanced: isAdvancedDatabase(candidate),
    essential: isEssentialDatabase(candidate),
    essentialTier: isEssentialTier(candidate),
    legacy: isLegacyDatabase(candidate),
    legacyEssential: isLegacyEssentialDatabase(candidate),
    postgres: isPostgresAddon(candidate),
  }
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
  const legacyEssential = {
    advanced: false,
    essential: false,
    essentialTier: true,
    legacy: true,
    legacyEssential: true,
    postgres: true,
  }
  const advanced = {
    advanced: true,
    essential: false,
    essentialTier: false,
    legacy: false,
    legacyEssential: false,
    postgres: true,
  }
  const notPostgres = {
    advanced: false,
    essential: false,
    essentialTier: false,
    legacy: false,
    legacyEssential: false,
    postgres: false,
  }

  it('treats essential plans as the Essential tier', () => {
    expect(classify('heroku-postgresql:essential-0')).toEqual({
      advanced: false,
      essential: true,
      essentialTier: true,
      legacy: true,
      legacyEssential: false,
      postgres: true,
    })
  })

  it('treats dev plans as legacy Essential tier', () => {
    expect(classify('heroku-postgresql:dev')).toEqual(legacyEssential)
  })

  it('treats basic plans as legacy Essential tier', () => {
    expect(classify('heroku-postgresql:basic')).toEqual(legacyEssential)
  })

  it('treats mini plans as legacy Essential tier', () => {
    expect(classify('heroku-postgresql:mini')).toEqual(legacyEssential)
  })

  it('treats standard plans as legacy postgres outside the Essential tier', () => {
    expect(classify('heroku-postgresql:standard-0')).toEqual({
      advanced: false,
      essential: false,
      essentialTier: false,
      legacy: true,
      legacyEssential: false,
      postgres: true,
    })
  })

  it('treats advanced plans as advanced postgres', () => {
    expect(classify('heroku-postgresql:advanced-0')).toEqual(advanced)
  })

  it('treats performance plans as advanced postgres', () => {
    expect(classify('heroku-postgresql:performance-l')).toEqual(advanced)
  })

  it('does not treat redis plans as postgres', () => {
    expect(classify('heroku-redis:premium-0')).toEqual(notPostgres)
  })

  it('treats a missing plan as not postgres', () => {
    expect(classify()).toEqual(notPostgres)
  })
})

describe('isAdvancedCredential', () => {
  it('recognizes an advanced credential', () => {
    const credential: AdvancedCredentialInfo = {
      // eslint-disable-next-line camelcase
      created_at: '2025-01-01T12:00:00Z',
      database: 'd123',
      host: 'ec2.amazonaws.com',
      id: 'cred-id',
      name: 'owner',
      port: 5432,
      roles: [{password: 'secret', state: 'active', user: 'owner'}],
      state: 'active',
      type: 'owner',
    }

    expect(isAdvancedCredential(credential)).toBe(true)
  })

  it('does not treat a classic credential as advanced', () => {
    const credential: NonAdvancedCredentialInfo = {
      credentials: [{password: 'secret', state: 'active', user: 'default'}],
      database: 'd123',
      host: 'ec2.amazonaws.com',
      name: 'default',
      port: 5432,
      state: 'active',
      uuid: 'cred-uuid',
    }

    expect(isAdvancedCredential(credential)).toBe(false)
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
