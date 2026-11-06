import {NotFoundError} from '@heroku/heroku-fetch'
import {
  afterEach, describe, expect, it, vi,
} from 'vitest'

import type {ResourceCtx} from '../../core/extend-resource.js'

import {HerokuSDK} from '../../index.js'
import {EssentialDatabaseNotSupportedError} from './internal/postgres-utils.js'
import {PgDatabaseNotFoundError} from './internal/resolve-pg-database.js'
import {
  createForDatabase, deleteFromDatabase, InvalidLinkRemoteError, linkExtensions, listByApp,
} from './link.js'

type Mock = ReturnType<typeof vi.fn>

function pgAttachment(opts: {addonId?: string; addonName?: string; app?: string; name?: string; plan?: string} = {}) {
  const app = {id: `${opts.app ?? 'app-1'}-uuid`, name: opts.app ?? 'app-1'}
  return {
    addon: {
      app,
      id: opts.addonId ?? 'addon-1',
      name: opts.addonName ?? 'postgresql-db-1',
      plan: {name: opts.plan ?? 'heroku-postgresql:standard-0'},
    },
    app: {id: 'app-1-uuid', name: 'app-1'},
    // eslint-disable-next-line camelcase
    config_vars: [`${opts.name ?? 'DATABASE'}_URL`],
    id: `att-${opts.addonId ?? 'addon-1'}-${opts.name ?? 'DATABASE'}`,
    name: opts.name ?? 'DATABASE',
  }
}

function remoteAddon(opts: {app?: string; id?: string; name?: string; plan?: string} = {}) {
  const app = {id: `${opts.app ?? 'app-1'}-uuid`, name: opts.app ?? 'app-1'}
  return {
    // eslint-disable-next-line camelcase
    addon_service: {name: (opts.plan ?? 'heroku-redis:premium-0').split(':')[0]},
    app,
    id: opts.id ?? 'remote-1',
    name: opts.name ?? 'redis-remote-1',
    plan: {name: opts.plan ?? 'heroku-redis:premium-0'},
  }
}

function buildCtx(opts: {
  addonResolution?: Mock
  attachmentListByApp?: Mock
  attachmentResolution?: Mock
  linkCreate?: Mock
  linkDelete?: Mock
  linkList?: Mock
} = {}) {
  const data: Record<string, unknown> = {
    link: {
      create: opts.linkCreate ?? vi.fn(),
      delete: opts.linkDelete ?? vi.fn(),
      list: opts.linkList ?? vi.fn().mockResolvedValue([]),
    },
  }
  data.withOptions = vi.fn(() => data)

  const platform: Record<string, unknown> = {
    addOn: {resolution: opts.addonResolution ?? vi.fn().mockResolvedValue([remoteAddon()])},
    addOnAttachment: {
      listByApp: opts.attachmentListByApp ?? vi.fn().mockResolvedValue([]),
      resolution: opts.attachmentResolution ?? vi.fn().mockResolvedValue([pgAttachment()]),
    },
    withHeaders: vi.fn(() => platform),
    withOptions: vi.fn(() => platform),
  }

  return {data, platform} as unknown as Pick<ResourceCtx, 'data' | 'platform'> & {
    data: {link: {create: Mock; delete: Mock; list: Mock}; withOptions: Mock}
    platform: {
      addOn: {resolution: Mock}
      addOnAttachment: {listByApp: Mock; resolution: Mock}
      withHeaders: Mock
      withOptions: Mock
    }
  }
}

const LINK = {
  // eslint-disable-next-line camelcase
  created_at: '2026-01-01T00:00:00Z',
  id: 'link-1',
  name: 'redis-link',
  remote: {attachment_name: 'REDIS', name: 'redis-remote-1'}, // eslint-disable-line camelcase
  remote_name: 'redis-remote-1', // eslint-disable-line camelcase
}

describe('link resource', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('listByApp', () => {
    it('resolves the given database and returns its links', async () => {
      const ctx = buildCtx({linkList: vi.fn().mockResolvedValue([LINK])})

      const result = await listByApp(ctx, 'app-1', 'DATABASE')

      expect(ctx.platform.addOnAttachment.resolution).toHaveBeenCalledWith({addon_attachment: 'DATABASE', app: 'app-1'}) // eslint-disable-line camelcase
      expect(ctx.data.link.list).toHaveBeenCalledWith('addon-1')
      expect(result).toEqual([{addon: pgAttachment().addon, links: [LINK]}])
    })

    it('resolves app::database against the named app', async () => {
      const ctx = buildCtx()

      await listByApp(ctx, 'app-1', 'other-app::DATABASE')

      expect(ctx.platform.addOnAttachment.resolution).toHaveBeenCalledWith({addon_attachment: 'DATABASE', app: 'other-app'}) // eslint-disable-line camelcase
    })

    it('lists links on every legacy database when no database is given', async () => {
      const attachmentListByApp = vi.fn().mockResolvedValue([
        pgAttachment({addonId: 'a', addonName: 'pg-a', name: 'DATABASE'}),
        pgAttachment({addonId: 'a', addonName: 'pg-a', name: 'HEROKU_POSTGRESQL_RED'}),
        pgAttachment({addonId: 'b', addonName: 'pg-b', name: 'HEROKU_POSTGRESQL_BLUE'}),
      ])
      const linkList = vi.fn(async (id: string) => (id === 'a' ? [LINK] : []))
      const ctx = buildCtx({attachmentListByApp, linkList})

      const result = await listByApp(ctx, 'app-1')

      expect(ctx.platform.addOnAttachment.resolution).not.toHaveBeenCalled()
      expect(result.map(r => [r.addon.name, r.links.length])).toEqual([['pg-a', 1], ['pg-b', 0]])
    })

    it('returns an empty array when the app has no databases', async () => {
      const ctx = buildCtx()

      expect(await listByApp(ctx, 'app-1')).toEqual([])
      expect(ctx.data.link.list).not.toHaveBeenCalled()
    })

    it('throws PgDatabaseNotFoundError when the database does not resolve', async () => {
      const ctx = buildCtx({attachmentResolution: vi.fn().mockResolvedValue([])})

      await expect(listByApp(ctx, 'app-1', 'NOPE')).rejects.toBeInstanceOf(PgDatabaseNotFoundError)
    })
  })

  describe('createForDatabase', () => {
    it('resolves both sides and creates the link by add-on id with the remote name', async () => {
      const ctx = buildCtx({linkCreate: vi.fn().mockResolvedValue(LINK)})

      const result = await createForDatabase(ctx, 'app-1', 'DATABASE', 'redis-remote-1', {as: 'my-link'})

      expect(ctx.platform.addOn.resolution).toHaveBeenCalledWith({addon: 'redis-remote-1', app: 'app-1'})
      expect(ctx.data.link.create).toHaveBeenCalledWith('addon-1', {as: 'my-link', target: 'redis-remote-1'})
      expect(result).toEqual({addon: pgAttachment().addon, link: LINK, target: remoteAddon()})
    })

    it('defaults the database to DATABASE_URL', async () => {
      const ctx = buildCtx({linkCreate: vi.fn().mockResolvedValue(LINK)})

      await createForDatabase(ctx, 'app-1', undefined, 'redis-remote-1')

      expect(ctx.platform.addOnAttachment.resolution).toHaveBeenCalledWith({addon_attachment: 'DATABASE_URL', app: 'app-1'}) // eslint-disable-line camelcase
    })

    it.each([
      ['NotFoundError', () => Promise.reject(new NotFoundError(new Response(null, {status: 404}), {id: 'not_found', resource: 'add_on'}))],
      ['an empty app-scoped match', () => Promise.resolve([])],
    ])('retries the remote globally after %s', async (_label, appScoped) => {
      const other = remoteAddon({app: 'app-2', name: 'pg-on-app-2', plan: 'heroku-postgresql:standard-0'})
      const addonResolution = vi.fn()
        .mockImplementationOnce(appScoped)
        .mockResolvedValueOnce([other])
      const ctx = buildCtx({addonResolution, linkCreate: vi.fn().mockResolvedValue(LINK)})

      const result = await createForDatabase(ctx, 'app-1', 'DATABASE', 'pg-on-app-2')

      expect(addonResolution).toHaveBeenNthCalledWith(1, {addon: 'pg-on-app-2', app: 'app-1'})
      expect(addonResolution).toHaveBeenNthCalledWith(2, {addon: 'pg-on-app-2'})
      expect(result.target).toEqual(other)
    })

    it('resolves an app::remote identity globally without a retry', async () => {
      const ctx = buildCtx({linkCreate: vi.fn().mockResolvedValue(LINK)})

      await createForDatabase(ctx, 'app-1', 'DATABASE', 'app-2::REDIS')

      expect(ctx.platform.addOn.resolution).toHaveBeenCalledOnce()
      expect(ctx.platform.addOn.resolution).toHaveBeenCalledWith({addon: 'app-2::REDIS'})
    })

    it('rejects a remote that is not Postgres or Key-Value Store', async () => {
      const ctx = buildCtx({addonResolution: vi.fn().mockResolvedValue([remoteAddon({plan: 'papertrail:choklad'})])})

      await expect(createForDatabase(ctx, 'app-1', 'DATABASE', 'papertrail-1')).rejects.toBeInstanceOf(InvalidLinkRemoteError)
      expect(ctx.data.link.create).not.toHaveBeenCalled()
    })

    it('rejects an Essential-tier database', async () => {
      const ctx = buildCtx({attachmentResolution: vi.fn().mockResolvedValue([pgAttachment({plan: 'heroku-postgresql:essential-0'})])})

      const error = await createForDatabase(ctx, 'app-1', 'DATABASE', 'redis-remote-1').catch(error_ => error_)

      expect(error).toBeInstanceOf(EssentialDatabaseNotSupportedError)
      expect(error.addon.name).toBe('postgresql-db-1')
      expect(ctx.data.link.create).not.toHaveBeenCalled()
    })

    it('rejects an Essential-tier remote', async () => {
      const ctx = buildCtx({addonResolution: vi.fn().mockResolvedValue([remoteAddon({name: 'pg-mini', plan: 'heroku-postgresql:mini'})])})

      const error = await createForDatabase(ctx, 'app-1', 'DATABASE', 'pg-mini').catch(error_ => error_)

      expect(error).toBeInstanceOf(EssentialDatabaseNotSupportedError)
      expect(error.addon.name).toBe('pg-mini')
      expect(ctx.data.link.create).not.toHaveBeenCalled()
    })

    it('calls onResolved before the create, and a throw prevents it', async () => {
      const ctx = buildCtx({linkCreate: vi.fn().mockResolvedValue(LINK)})
      const onResolved = vi.fn(() => {
        expect(ctx.data.link.create).not.toHaveBeenCalled()
      })

      await createForDatabase(ctx, 'app-1', 'DATABASE', 'redis-remote-1', {}, {onResolved})
      expect(onResolved).toHaveBeenCalledWith({addon: pgAttachment().addon, target: remoteAddon()})

      ctx.data.link.create.mockClear()
      await expect(createForDatabase(ctx, 'app-1', 'DATABASE', 'redis-remote-1', {}, {
        onResolved() {
          throw new Error('nope')
        },
      })).rejects.toThrow('nope')
      expect(ctx.data.link.create).not.toHaveBeenCalled()
    })
  })

  describe('deleteFromDatabase', () => {
    it('resolves the database and deletes the link by add-on id', async () => {
      const ctx = buildCtx({linkDelete: vi.fn().mockResolvedValue(LINK)})

      const result = await deleteFromDatabase(ctx, 'app-1', 'DATABASE', 'redis-link')

      expect(ctx.data.link.delete).toHaveBeenCalledWith('addon-1', 'redis-link')
      expect(result).toEqual({addon: pgAttachment().addon, link: LINK})
    })

    it('rejects an Essential-tier database before onResolved', async () => {
      const ctx = buildCtx({attachmentResolution: vi.fn().mockResolvedValue([pgAttachment({plan: 'heroku-postgresql:essential-1'})])})
      const onResolved = vi.fn()

      await expect(deleteFromDatabase(ctx, 'app-1', 'DATABASE', 'redis-link', {onResolved}))
        .rejects.toBeInstanceOf(EssentialDatabaseNotSupportedError)
      expect(onResolved).not.toHaveBeenCalled()
      expect(ctx.data.link.delete).not.toHaveBeenCalled()
    })

    it('does not delete when onResolved throws', async () => {
      const ctx = buildCtx()

      await expect(deleteFromDatabase(ctx, 'app-1', 'DATABASE', 'redis-link', {
        onResolved() {
          throw new Error('confirmation mismatch')
        },
      })).rejects.toThrow('confirmation mismatch')
      expect(ctx.data.link.delete).not.toHaveBeenCalled()
    })

    it('binds the signal to the data client', async () => {
      const ctx = buildCtx()
      const controller = new AbortController()

      await deleteFromDatabase(ctx, 'app-1', 'DATABASE', 'redis-link', {signal: controller.signal})

      expect(ctx.data.withOptions).toHaveBeenCalledWith({signal: controller.signal})
    })
  })

  describe('registration', () => {
    it('declares service: data, resource: link', () => {
      expect(linkExtensions.service).toBe('data')
      expect(linkExtensions.resource).toBe('link')
    })

    it('keeps the generated link routes alongside the extensions', () => {
      const sdk = new HerokuSDK({extensions: [linkExtensions]})

      expect(sdk.data.link.list).toBeTypeOf('function')
      expect(sdk.data.link.create).toBeTypeOf('function')
      expect(sdk.data.link.delete).toBeTypeOf('function')
      expect(sdk.data.link.listByApp).toBeTypeOf('function')
      expect(sdk.data.link.createForDatabase).toBeTypeOf('function')
      expect(sdk.data.link.deleteFromDatabase).toBeTypeOf('function')
    })
  })
})
