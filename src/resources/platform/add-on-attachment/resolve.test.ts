import type {AddOnAttachment} from '@heroku/types/3.sdk'

import {
  afterEach, describe, expect, it, vi,
} from 'vitest'

import type {ResourceCtx} from '../../../core/extend-resource.js'
import type {ResolvedAddOnAttachment} from './resolve.js'

import {legacyResourceCtx} from '../../../../test-types/heroku-sdk-options.js'
import {AddonAttachmentAmbiguousError, AddonAttachmentNotFoundError, resolveAddonAttachment} from './resolve.js'

function buildCtx({
  resolveByAttachmentResponses = [],
}: {
  resolveByAttachmentResponses?: AddOnAttachment[]
} = {}): {
  ctx: ResourceCtx
  resolutionByAttachment: ReturnType<typeof vi.fn>
  withHeaders: ReturnType<typeof vi.fn>
  withOptions: ReturnType<typeof vi.fn>
} {
  const resolutionByAttachment = vi.fn().mockResolvedValue(resolveByAttachmentResponses)

  const platform = {
    addOnAttachment: {resolution: resolutionByAttachment},
    withHeaders: vi.fn(),
    withOptions: vi.fn(),
  }
  // withHeaders/withOptions should return a same-shaped client; our mock is self-referential.
  platform.withHeaders.mockReturnValue(platform)
  platform.withOptions.mockReturnValue(platform)

  return {
    ctx: {
      ...legacyResourceCtx,
      data: {} as never,
      platform: platform as never,
    },
    resolutionByAttachment,
    withHeaders: platform.withHeaders,
    withOptions: platform.withOptions,
  }
}

describe('resolveAddonAttachment', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  it('returns the full attachment including web_url', async () => {
    const {ctx, resolutionByAttachment} = buildCtx({
      resolveByAttachmentResponses: [
        // eslint-disable-next-line camelcase
        {addon: {app: {id: 'app-uuid', name: 'my-app'}, id: 'addon-id', name: 'postgres-addon'}, web_url: 'https://addons-sso.heroku.com/apps/my-app/addons/addon-id'} as AddOnAttachment,
      ],
    })

    const result = await resolveAddonAttachment(ctx, 'my-app', 'DATABASE_URL')

    expect(resolutionByAttachment).toHaveBeenCalledWith({
      // eslint-disable-next-line camelcase
      addon_attachment: 'DATABASE_URL',
      app: 'my-app',
    })
    expect(result.web_url).toBe('https://addons-sso.heroku.com/apps/my-app/addons/addon-id')
    expect(result.addon.id).toBe('addon-id')
    expect(result.addon.app.id).toBe('app-uuid')
  })

  it('resolves successfully with a null web_url (add-on with no web dashboard)', async () => {
    const {ctx} = buildCtx({
      resolveByAttachmentResponses: [
        // eslint-disable-next-line camelcase
        {addon: {app: {id: 'app-uuid', name: 'my-app'}, id: 'addon-id', name: 'no-dashboard-addon'}, web_url: null} as AddOnAttachment,
      ],
    })

    // null web_url is a valid result, not a not-found: resolve, don't throw.
    const result = await resolveAddonAttachment(ctx, 'my-app', 'DATABASE_URL')

    expect(result.web_url).toBeNull()
    expect(result.addon.id).toBe('addon-id')
  })

  it('throws AddonAttachmentNotFoundError when no attachment matches', async () => {
    const {ctx} = buildCtx({resolveByAttachmentResponses: []})

    await expect(resolveAddonAttachment(ctx, 'my-app', 'NONEXISTENT')).rejects.toBeInstanceOf(AddonAttachmentNotFoundError)
  })

  it('filters attachments by addon service when provided', async () => {
    const {ctx, resolutionByAttachment, withHeaders} = buildCtx({
      resolveByAttachmentResponses: [
        {
          addon: {
            app: {id: 'app-uuid', name: 'my-app'}, id: 'pg-id', name: 'postgres-addon', plan: {name: 'heroku-postgresql:essential-0'},
          },
        } as ResolvedAddOnAttachment,
        {
          addon: {
            app: {id: 'app-uuid', name: 'my-app'}, id: 'redis-id', name: 'redis-addon', plan: {name: 'heroku-redis:premium-0'},
          },
        } as ResolvedAddOnAttachment,
      ],
    })

    const result = await resolveAddonAttachment(ctx, 'my-app', 'DATABASE_URL', {addonService: 'heroku-postgresql'})

    expect(resolutionByAttachment).toHaveBeenCalledWith({
      // eslint-disable-next-line camelcase
      addon_attachment: 'DATABASE_URL',
      app: 'my-app',
    })
    expect(withHeaders).toHaveBeenCalledWith({'Accept-Inclusion': 'addon:plan'})
    expect(result.addon.id).toBe('pg-id')
  })

  it('throws AddonAttachmentNotFoundError when the matched attachment lacks an addon id', async () => {
    const {ctx} = buildCtx({
      resolveByAttachmentResponses: [
        {addon: {app: {name: 'my-app'}, name: 'incomplete'}} as AddOnAttachment,
      ],
    })

    await expect(resolveAddonAttachment(ctx, 'my-app', 'DATABASE_URL')).rejects.toBeInstanceOf(AddonAttachmentNotFoundError)
  })

  it('throws AddonAttachmentNotFoundError when the matched attachment\'s addon lacks app.id', async () => {
    const {ctx} = buildCtx({
      resolveByAttachmentResponses: [
        {addon: {app: {name: 'my-app'}, id: 'addon-id', name: 'x'}} as AddOnAttachment,
      ],
    })

    await expect(resolveAddonAttachment(ctx, 'my-app', 'DATABASE_URL')).rejects.toBeInstanceOf(AddonAttachmentNotFoundError)
  })

  it('throws AddonAttachmentAmbiguousError when the matched attachment is ambiguous', async () => {
    const {ctx} = buildCtx({
      resolveByAttachmentResponses: [
        {addon: {app: {id: 'app-uuid', name: 'my-app'}, id: 'addon-id', name: 'postgres-addon'}} as AddOnAttachment,
        {addon: {app: {id: 'app-uuid', name: 'my-app'}, id: 'other-addon-id', name: 'other-addon'}} as AddOnAttachment,
      ],
    })

    await expect(resolveAddonAttachment(ctx, 'my-app', 'DATABASE_URL')).rejects.toBeInstanceOf(AddonAttachmentAmbiguousError)
  })

  it('throws if the signal is already aborted', async () => {
    const {ctx, resolutionByAttachment, withOptions} = buildCtx()
    const controller = new AbortController()
    controller.abort()

    await expect(resolveAddonAttachment(ctx, 'my-app', 'DATABASE_URL', {signal: controller.signal})).rejects.toThrow()
    expect(resolutionByAttachment).not.toHaveBeenCalled()
    expect(withOptions).not.toHaveBeenCalled()
  })

  it('forwards the signal to the resolution call via withOptions', async () => {
    const {ctx, withOptions} = buildCtx({
      resolveByAttachmentResponses: [
        {addon: {app: {id: 'app-uuid', name: 'my-app'}, id: 'addon-id', name: 'postgres-addon'}} as AddOnAttachment,
      ],
    })
    const controller = new AbortController()

    await resolveAddonAttachment(ctx, 'my-app', 'DATABASE_URL', {signal: controller.signal})

    expect(withOptions).toHaveBeenCalledWith({signal: controller.signal})
  })

  it('calls withOptions with an undefined signal when none is provided', async () => {
    const {ctx, withOptions} = buildCtx({
      resolveByAttachmentResponses: [
        {addon: {app: {id: 'app-uuid', name: 'my-app'}, id: 'addon-id', name: 'postgres-addon'}} as AddOnAttachment,
      ],
    })

    await resolveAddonAttachment(ctx, 'my-app', 'DATABASE_URL')

    expect(withOptions).toHaveBeenCalledWith({signal: undefined})
  })
})
