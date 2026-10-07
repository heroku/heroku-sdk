/* eslint-disable camelcase */
import {
  describe, expect, it, vi,
} from 'vitest'

import type {ResourceCtx} from '../../../core/extend-resource.js'
import type {AddOnAttachmentWithInclusions} from '../../platform/add-on-attachment/resolve.js'

import {AddonAttachmentAmbiguousError} from '../../platform/add-on-attachment/resolve.js'
import {resolvePgDatabase} from './resolve-pg-database.js'

function buildCtx({
  infoForApp = vi.fn(),
  resolutionByAttachment,
}: {
  infoForApp?: ReturnType<typeof vi.fn>
  resolutionByAttachment: ReturnType<typeof vi.fn>
}): ResourceCtx {
  return {
    data: {} as never,
    platform: {
      addOnAttachment: {resolution: resolutionByAttachment},
      configVar: {infoForApp},
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

  it('defaults to the DATABASE_URL attachment when input is omitted', async () => {
    const resolutionByAttachment = vi.fn().mockResolvedValue([pgAttachment()])
    const ctx = buildCtx({resolutionByAttachment})

    const result = await resolvePgDatabase(ctx, {appIdentity: 'app-1'})

    expect(resolutionByAttachment).toHaveBeenCalledWith({addon_attachment: 'DATABASE_URL', app: 'app-1'})
    expect(result.id).toBe('addon-id')
  })

  it('routes a SHOUTY_SNAKE_CASE config var input through addOnAttachment.resolution scoped to the app', async () => {
    const resolutionByAttachment = vi.fn().mockResolvedValue([pgAttachment({id: 'addon-13'})])
    const ctx = buildCtx({resolutionByAttachment})

    const result = await resolvePgDatabase(ctx, {appIdentity: 'app-1', input: 'HEROKU_POSTGRESQL_GREEN'})

    expect(resolutionByAttachment).toHaveBeenCalledWith({addon_attachment: 'HEROKU_POSTGRESQL_GREEN', app: 'app-1'})
    expect(result.id).toBe('addon-13')
  })

  it('routes a kebab-case global add-on name through addOnAttachment.resolution', async () => {
    const resolutionByAttachment = vi.fn().mockResolvedValue([pgAttachment()])
    const ctx = buildCtx({resolutionByAttachment})

    await resolvePgDatabase(ctx, {appIdentity: 'app-1', input: 'postgres-curved-12345'})

    expect(resolutionByAttachment).toHaveBeenCalledWith({addon_attachment: 'postgres-curved-12345', app: 'app-1'})
  })

  it('resolves globally when no appIdentity is given and the input has no app context', async () => {
    const resolutionByAttachment = vi.fn().mockResolvedValue([pgAttachment()])
    const ctx = buildCtx({resolutionByAttachment})

    await resolvePgDatabase(ctx, {input: 'postgres-curved-12345'})

    expect(resolutionByAttachment).toHaveBeenCalledWith({addon_attachment: 'postgres-curved-12345', app: undefined})
  })

  it('throws when a match is found but its addon service is not heroku-postgresql', async () => {
    const resolutionByAttachment = vi.fn().mockResolvedValue([pgAttachment({planName: 'heroku-redis:premium-0'})])
    const ctx = buildCtx({resolutionByAttachment})

    await expect(resolvePgDatabase(ctx, {appIdentity: 'app-1'})).rejects.toThrow()
  })

  it('throws when input is omitted and no appIdentity is provided', async () => {
    const ctx = buildCtx({resolutionByAttachment: vi.fn()})
    await expect(resolvePgDatabase(ctx, {})).rejects.toThrow(/requires either input or appIdentity/)
  })

  it('collapses matches that are the same add-on attached under two names resolving to the same URL', async () => {
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

  it('still throws ambiguous when same-addon matches resolve to different URLs', async () => {
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
  })

  it('does not attempt to collapse matches that point at different add-ons', async () => {
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
