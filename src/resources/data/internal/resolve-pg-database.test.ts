/* eslint-disable camelcase */
import {NotFoundError} from '@heroku/heroku-fetch'
import {
  afterEach, describe, expect, it, vi,
} from 'vitest'

import type {ResourceCtx} from '../../../core/extend-resource.js'
import type {AddOnAttachmentWithInclusions} from '../../platform/add-on-attachment/resolve.js'

import {AddonAttachmentAmbiguousError, AddonAttachmentNotFoundError} from '../../platform/add-on-attachment/resolve.js'
import {PgDatabaseNotFoundError, resolvePgDatabase} from './resolve-pg-database.js'

function buildCtx({
  infoForApp,
  listByApp,
  resolutionByAttachment,
}: {
  infoForApp?: ReturnType<typeof vi.fn>
  listByApp?: ReturnType<typeof vi.fn>
  resolutionByAttachment?: ReturnType<typeof vi.fn>
}): Pick<ResourceCtx, 'platform'> {
  return {
    platform: {
      addOnAttachment: {
        listByApp: listByApp ?? vi.fn(),
        resolution: resolutionByAttachment ?? vi.fn(),
      },
      configVar: {infoForApp: infoForApp ?? vi.fn()},
      withHeaders() {
        return this
      },
      withOptions() {
        return this
      },
    } as never,
  }
}

function pgAttachment(overrides: {
  attachmentId?: string
  configVars?: string[]
  id?: string
  planName?: string
} = {}): AddOnAttachmentWithInclusions {
  return {
    addon: {
      app: {id: 'app-uuid', name: 'parent-app'},
      id: overrides.id ?? 'addon-id',
      name: 'pg',
      plan: {name: overrides.planName ?? 'heroku-postgresql:essential-0'},
    },
    app: {id: 'app-uuid', name: 'parent-app'},
    config_vars: overrides.configVars ?? ['DATABASE_URL'],
    created_at: '2024-01-01T00:00:00Z',
    id: overrides.attachmentId ?? 'attachment-id',
    log_input_url: null,
    name: 'DATABASE',
    namespace: null,
    updated_at: '2024-01-01T00:00:00Z',
    web_url: null,
  }
}

function notFoundError(): NotFoundError {
  return new NotFoundError(new Response(null, {status: 404}), {id: 'not_found'})
}

describe('resolvePgDatabase', () => {
  const resolveNotFoundError = notFoundError()

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('routes a parent::branch reference through addOnAttachment.resolution with parsed parts', async () => {
    const resolutionByAttachment = vi.fn().mockResolvedValue([pgAttachment()])
    const ctx = buildCtx({resolutionByAttachment})

    const result = await resolvePgDatabase(ctx, 'other-app', {input: 'parent-app::branch'})

    expect(resolutionByAttachment).toHaveBeenCalledWith({addon_attachment: 'branch', app: 'parent-app'})
    expect(result.id).toBe('addon-id')
  })

  it('routes a SHOUTY_SNAKE_CASE input through addOnAttachment.resolution', async () => {
    const resolutionByAttachment = vi.fn().mockResolvedValue([pgAttachment({id: 'addon-13'})])
    const ctx = buildCtx({resolutionByAttachment})

    const result = await resolvePgDatabase(ctx, 'app-1', {input: 'HEROKU_POSTGRESQL_GREEN'})

    expect(resolutionByAttachment).toHaveBeenCalledWith({
      addon_attachment: 'HEROKU_POSTGRESQL_GREEN',
      app: 'app-1',
    })
    expect(result.id).toBe('addon-13')
  })

  it('routes a kebab-case input through addOnAttachment.resolution', async () => {
    const resolutionByAttachment = vi.fn().mockResolvedValue([pgAttachment()])
    const ctx = buildCtx({resolutionByAttachment})

    await resolvePgDatabase(ctx, 'app-1', {input: 'postgres-curved-12345'})

    expect(resolutionByAttachment).toHaveBeenCalledWith({addon_attachment: 'postgres-curved-12345', app: 'app-1'})
  })

  it('defaults to the DATABASE_URL attachment when input is omitted', async () => {
    const resolutionByAttachment = vi.fn().mockResolvedValue([pgAttachment()])
    const ctx = buildCtx({resolutionByAttachment})

    await resolvePgDatabase(ctx, 'app-1')

    expect(resolutionByAttachment).toHaveBeenCalledWith({
      addon_attachment: 'DATABASE_URL',
      app: 'app-1',
    })
  })

  it('uses the app:: prefix in the input instead of appIdentity', async () => {
    const resolutionByAttachment = vi.fn().mockResolvedValue([pgAttachment()])
    const ctx = buildCtx({resolutionByAttachment})

    await resolvePgDatabase(ctx, 'app-1', {input: 'app::postgres-curved-12345'})

    expect(resolutionByAttachment).toHaveBeenCalledWith({addon_attachment: 'postgres-curved-12345', app: 'app'})
  })

  it('throws when appIdentity is empty, without reaching the API', async () => {
    const resolutionByAttachment = vi.fn()
    const listByApp = vi.fn()
    const ctx = buildCtx({listByApp, resolutionByAttachment})

    await expect(resolvePgDatabase(ctx, ''))
      .rejects.toThrow('resolvePgDatabase requires a non-empty app identity.')
    expect(resolutionByAttachment).not.toHaveBeenCalled()
    expect(listByApp).not.toHaveBeenCalled()
  })

  it('throws PgDatabaseNotFoundError when the app has no databases', async () => {
    const listByApp = vi.fn().mockResolvedValue([])
    const resolutionByAttachment = vi.fn().mockRejectedValue(resolveNotFoundError)
    const ctx = buildCtx({listByApp, resolutionByAttachment})

    const error = await resolvePgDatabase(ctx, 'app-1').catch(error_ => error_)

    expect(error).toBeInstanceOf(PgDatabaseNotFoundError)
    expect(error).toHaveProperty('message', 'app-1 has no heroku-postgresql databases')
    expect(error).toHaveProperty('cause', resolveNotFoundError)
    expect(listByApp).toHaveBeenCalledWith('app-1')
  })

  it('throws PgDatabaseNotFoundError when the app has no databases for the configured service', async () => {
    const listByApp = vi.fn().mockResolvedValue([pgAttachment()])
    const resolutionByAttachment = vi.fn().mockResolvedValue([pgAttachment()])
    const ctx = buildCtx({listByApp, resolutionByAttachment})

    vi.stubEnv('HEROKU_POSTGRESQL_ADDON_NAME', 'other-service')

    const error = await resolvePgDatabase(ctx, 'app-1').catch(error_ => error_)

    expect(error).toBeInstanceOf(PgDatabaseNotFoundError)
    expect(error).toHaveProperty('message', 'app-1 has no other-service databases')
    expect(error.cause).toBeInstanceOf(AddonAttachmentNotFoundError)
    expect(listByApp).toHaveBeenCalledWith('app-1')
  })

  it('throws PgDatabaseNotFoundError when the attachment resolve endpoint 404s', async () => {
    const listByApp = vi.fn().mockResolvedValue([
      pgAttachment(),
      pgAttachment({attachmentId: 'attachment-2', configVars: ['HEROKU_POSTGRESQL_PINK_URL']}),
      pgAttachment({attachmentId: 'attachment-3', planName: 'other-service:premium-0'}),
    ])
    const resolutionByAttachment = vi.fn().mockRejectedValue(resolveNotFoundError)
    const ctx = buildCtx({listByApp, resolutionByAttachment})

    const error = await resolvePgDatabase(ctx, 'app-1', {input: 'HEROKU_POSTGRESQL_RED'}).catch(error_ => error_)

    expect(error).toBeInstanceOf(PgDatabaseNotFoundError)
    expect(error).toHaveProperty('message', 'Unknown database: HEROKU_POSTGRESQL_RED on app-1. Valid options are: DATABASE, HEROKU_POSTGRESQL_PINK')
    expect(error).toHaveProperty('cause', resolveNotFoundError)
    expect(listByApp).toHaveBeenCalledWith('app-1')
  })

  it('throws PgDatabaseNotFoundError with the parsed app when a cross-app reference is not found', async () => {
    const listByApp = vi.fn().mockResolvedValue([pgAttachment()])
    const resolutionByAttachment = vi.fn().mockRejectedValue(resolveNotFoundError)
    const ctx = buildCtx({listByApp, resolutionByAttachment})

    const error = await resolvePgDatabase(ctx, 'app-1', {input: 'other-app::MISSING'}).catch(error_ => error_)

    expect(error).toBeInstanceOf(PgDatabaseNotFoundError)
    expect(error).toHaveProperty('message', 'Unknown database: MISSING on other-app. Valid options are: DATABASE')
    expect(listByApp).toHaveBeenCalledWith('other-app')
  })

  it('throws PgDatabaseNotFoundError when the attachment is not for the configured service', async () => {
    const listByApp = vi.fn().mockResolvedValue([
      pgAttachment(),
      pgAttachment({attachmentId: 'attachment-2', configVars: ['HEROKU_POSTGRESQL_PINK_URL'], planName: 'other-service:premium-0'}),
    ])
    const resolutionByAttachment = vi.fn().mockResolvedValue([pgAttachment()])
    const ctx = buildCtx({listByApp, resolutionByAttachment})

    vi.stubEnv('HEROKU_POSTGRESQL_ADDON_NAME', 'other-service')

    const error = await resolvePgDatabase(ctx, 'app-1').catch(error_ => error_)

    expect(error).toBeInstanceOf(PgDatabaseNotFoundError)
    expect(error).toHaveProperty('message', 'DATABASE is not a other-service database on app-1. Valid options are: HEROKU_POSTGRESQL_PINK')
    expect(error.cause).toBeInstanceOf(AddonAttachmentNotFoundError)
    expect(listByApp).toHaveBeenCalledWith('app-1')
  })

  it('throws an error when an attachment in the valid-options list has no _URL config var', async () => {
    const listByApp = vi.fn().mockResolvedValue([
      pgAttachment({attachmentId: 'attachment-2', configVars: ['SOME_OTHER_VAR']}),
    ])
    const resolutionByAttachment = vi.fn().mockRejectedValue(resolveNotFoundError)
    const ctx = buildCtx({listByApp, resolutionByAttachment})

    await expect(resolvePgDatabase(ctx, 'app-1'))
      .rejects.toThrow('Database URL not found for this attachment')
  })

  it('throws an error when an ambiguous match has no _URL config var', async () => {
    const resolutionByAttachment = vi.fn().mockResolvedValue([
      pgAttachment({attachmentId: 'attachment-2', configVars: ['HEROKU_POSTGRESQL_PINK_URL']}),
      pgAttachment({attachmentId: 'attachment-1', configVars: ['SOME_OTHER_VAR']}),
    ])
    const infoForApp = vi.fn().mockResolvedValue({HEROKU_POSTGRESQL_PINK_URL: 'postgres://same'})
    const ctx = buildCtx({infoForApp, resolutionByAttachment})

    await expect(resolvePgDatabase(ctx, 'app-1'))
      .rejects.toThrow('Database URL not found for this attachment')
  })

  it('collapses ambiguous matches that target the same database', async () => {
    const resolutionByAttachment = vi.fn().mockResolvedValue([
      pgAttachment({attachmentId: 'attachment-1', configVars: ['DATABASE_URL']}),
      pgAttachment({attachmentId: 'attachment-2', configVars: ['HEROKU_POSTGRESQL_PINK_URL']}),
    ])
    const infoForApp = vi.fn().mockResolvedValue({
      DATABASE_URL: 'postgres://same',
      HEROKU_POSTGRESQL_PINK_URL: 'postgres://same',
    })
    const ctx = buildCtx({infoForApp, resolutionByAttachment})

    const result = await resolvePgDatabase(ctx, 'app-1')

    expect(result.id).toBe('addon-id')
    expect(infoForApp).toHaveBeenCalledWith('parent-app')
  })

  it('throws an error when ambiguous matches resolve to different databases', async () => {
    const resolutionByAttachment = vi.fn().mockResolvedValue([
      pgAttachment({attachmentId: 'attachment-1', configVars: ['DATABASE_URL']}),
      pgAttachment({attachmentId: 'attachment-2', configVars: ['HEROKU_POSTGRESQL_PINK_URL']}),
    ])
    const infoForApp = vi.fn().mockResolvedValue({
      DATABASE_URL: 'postgres://one',
      HEROKU_POSTGRESQL_PINK_URL: 'postgres://two',
    })
    const ctx = buildCtx({infoForApp, resolutionByAttachment})

    await expect(resolvePgDatabase(ctx, 'app-1')).rejects.toBeInstanceOf(AddonAttachmentAmbiguousError)
    expect(infoForApp).toHaveBeenCalledWith('parent-app')
  })

  it('does not attempt to collapse matches that point to different add-ons', async () => {
    const resolutionByAttachment = vi.fn().mockResolvedValue([
      pgAttachment({attachmentId: 'attachment-1', id: 'addon-1'}),
      pgAttachment({attachmentId: 'attachment-2', id: 'addon-2'}),
    ])
    const infoForApp = vi.fn()
    const ctx = buildCtx({infoForApp, resolutionByAttachment})

    await expect(resolvePgDatabase(ctx, 'app-1')).rejects.toBeInstanceOf(AddonAttachmentAmbiguousError)
    expect(infoForApp).not.toHaveBeenCalled()
  })

  it('returns the attachment and addon when includeAttachment is true', async () => {
    const resolutionByAttachment = vi.fn().mockResolvedValue([pgAttachment()])
    const ctx = buildCtx({resolutionByAttachment})

    const result = await resolvePgDatabase(ctx, 'app-1', {includeAttachment: true})

    expect(result.addon.id).toBe('addon-id')
    expect(result.attachment.id).toBe('attachment-id')
    expect(result.attachment.name).toBe('DATABASE')
  })

  it('returns the first equivalent attachment when includeAttachment is true', async () => {
    const resolutionByAttachment = vi.fn().mockResolvedValue([
      pgAttachment({attachmentId: 'attachment-1', configVars: ['DATABASE_URL']}),
      pgAttachment({attachmentId: 'attachment-2', configVars: ['HEROKU_POSTGRESQL_PINK_URL']}),
    ])
    const infoForApp = vi.fn().mockResolvedValue({
      DATABASE_URL: 'postgres://same',
      HEROKU_POSTGRESQL_PINK_URL: 'postgres://same',
    })
    const ctx = buildCtx({infoForApp, resolutionByAttachment})

    const result = await resolvePgDatabase(ctx, 'app-1', {includeAttachment: true})

    expect(result.addon.id).toBe('addon-id')
    expect(result.attachment.id).toBe('attachment-1')
  })
})
