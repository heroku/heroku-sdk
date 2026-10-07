/* eslint-disable camelcase */
import {
  describe, expect, it, vi,
} from 'vitest'

import type {ResourceCtx} from '../../../core/extend-resource.js'
import type {AddOnAttachmentWithInclusions} from '../../platform/add-on-attachment/resolve.js'

import {AddonAttachmentAmbiguousError} from '../../platform/add-on-attachment/resolve.js'
import {resolvePgDatabase} from './resolve-pg-database.js'

function buildCtx({
  infoForApp,
  resolutionByAttachment,
}: {
  infoForApp?: ReturnType<typeof vi.fn>
  resolutionByAttachment?: ReturnType<typeof vi.fn>
}): ResourceCtx {
  return {
    data: {} as never,
    platform: {
      addOnAttachment: {resolution: resolutionByAttachment ?? vi.fn()},
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

describe('resolvePgDatabase', () => {
  it('routes a parent::branch reference through addOnAttachment.resolution with parsed parts', async () => {
    const resolutionByAttachment = vi.fn().mockResolvedValue([pgAttachment()])
    const ctx = buildCtx({resolutionByAttachment})

    const result = await resolvePgDatabase(ctx, {input: 'parent-app::branch'})

    expect(resolutionByAttachment).toHaveBeenCalledWith({addon_attachment: 'branch', app: 'parent-app'})
    expect(result.id).toBe('addon-id')
  })

  it('routes a SHOUTY_SNAKE_CASE input through addOnAttachment.resolution', async () => {
    const resolutionByAttachment = vi.fn().mockResolvedValue([pgAttachment({id: 'addon-13'})])
    const ctx = buildCtx({resolutionByAttachment})

    const result = await resolvePgDatabase(ctx, {appIdentity: 'app-1', input: 'HEROKU_POSTGRESQL_GREEN'})

    expect(resolutionByAttachment).toHaveBeenCalledWith({
      addon_attachment: 'HEROKU_POSTGRESQL_GREEN',
      app: 'app-1',
    })
    expect(result.id).toBe('addon-13')
  })

  it('routes a kebab-case input through addOnAttachment.resolution', async () => {
    const resolutionByAttachment = vi.fn().mockResolvedValue([pgAttachment()])
    const ctx = buildCtx({resolutionByAttachment})

    await resolvePgDatabase(ctx, {appIdentity: 'app-1', input: 'postgres-curved-12345'})

    expect(resolutionByAttachment).toHaveBeenCalledWith({addon_attachment: 'postgres-curved-12345', app: 'app-1'})
  })

  it('defaults to the DATABASE_URL attachment when input is omitted', async () => {
    const resolutionByAttachment = vi.fn().mockResolvedValue([pgAttachment()])
    const ctx = buildCtx({resolutionByAttachment})

    await resolvePgDatabase(ctx, {appIdentity: 'app-1'})

    expect(resolutionByAttachment).toHaveBeenCalledWith({
      addon_attachment: 'DATABASE_URL',
      app: 'app-1',
    })
  })

  it('throws when input is omitted and no appIdentity is provided', async () => {
    const ctx = buildCtx({})
    await expect(resolvePgDatabase(ctx, {})).rejects.toThrow(/requires either input or appIdentity/)
  })

  it('resolves globally when no appIdentity is given and the input has no app context', async () => {
    const resolutionByAttachment = vi.fn().mockResolvedValue([pgAttachment()])
    const ctx = buildCtx({resolutionByAttachment})

    await resolvePgDatabase(ctx, {input: 'postgres-curved-12345'})

    expect(resolutionByAttachment).toHaveBeenCalledWith({addon_attachment: 'postgres-curved-12345', app: undefined})
  })

  it('uses the app:: prefix in the input instead of appIdentity', async () => {
    const resolutionByAttachment = vi.fn().mockResolvedValue([pgAttachment()])
    const ctx = buildCtx({resolutionByAttachment})

    await resolvePgDatabase(ctx, {appIdentity: 'app-1', input: 'app::postgres-curved-12345'})

    expect(resolutionByAttachment).toHaveBeenCalledWith({addon_attachment: 'postgres-curved-12345', app: 'app'})
  })

  it('throws when a match plan is not the configured Postgres addon service', async () => {
    const resolutionByAttachment = vi.fn().mockResolvedValue([pgAttachment({planName: 'heroku-redis:premium-0'})])
    const ctx = buildCtx({resolutionByAttachment})

    await expect(resolvePgDatabase(ctx, {appIdentity: 'app-1'})).rejects.toThrow()
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

    const result = await resolvePgDatabase(ctx, {appIdentity: 'app-1'})

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

    await expect(resolvePgDatabase(ctx, {appIdentity: 'app-1'})).rejects.toBeInstanceOf(AddonAttachmentAmbiguousError)
    expect(infoForApp).toHaveBeenCalledWith('parent-app')
  })

  it('does not attempt to collapse matches that point to different add-ons', async () => {
    const resolutionByAttachment = vi.fn().mockResolvedValue([
      pgAttachment({attachmentId: 'attachment-1', id: 'addon-1'}),
      pgAttachment({attachmentId: 'attachment-2', id: 'addon-2'}),
    ])
    const infoForApp = vi.fn()
    const ctx = buildCtx({infoForApp, resolutionByAttachment})

    await expect(resolvePgDatabase(ctx, {appIdentity: 'app-1'})).rejects.toBeInstanceOf(AddonAttachmentAmbiguousError)
    expect(infoForApp).not.toHaveBeenCalled()
  })
})
