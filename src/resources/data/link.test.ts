import {NotFoundError} from '@heroku/heroku-fetch'
import * as routes from '@heroku/types/data/routes'
import {
  afterEach, describe, expect, it, vi,
} from 'vitest'

import type {ResourceCtx} from '../../core/extend-resource.js'

import {HerokuSDK} from '../../index.js'
import {AddonAmbiguousError, AddonNotFoundError} from '../platform/add-on/errors.js'
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

function notFound(resource: string) {
  return new NotFoundError(new Response(null, {status: 404}), {id: 'not_found', message: 'not found', resource})
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
    vi.unstubAllEnvs()
  })

  describe('listByApp', () => {
    it('resolves the given database and returns its links with the resolved attachment name', async () => {
      const ctx = buildCtx({linkList: vi.fn().mockResolvedValue([LINK])})

      const result = await listByApp(ctx, 'app-1', 'DATABASE')

      expect(ctx.platform.addOnAttachment.resolution).toHaveBeenCalledWith({addon_attachment: 'DATABASE', app: 'app-1'}) // eslint-disable-line camelcase
      expect(ctx.data.link.list).toHaveBeenCalledWith('addon-1')
      expect(result).toEqual([{addon: {...pgAttachment().addon, attachmentNames: ['DATABASE']}, links: [LINK]}])
    })

    it('resolves app::database against the named app', async () => {
      const ctx = buildCtx()

      await listByApp(ctx, 'app-1', 'other-app::DATABASE')

      expect(ctx.platform.addOnAttachment.resolution).toHaveBeenCalledWith({addon_attachment: 'DATABASE', app: 'other-app'}) // eslint-disable-line camelcase
    })

    it('lists links on every legacy database, including Essential, when no database is given', async () => {
      const attachmentListByApp = vi.fn().mockResolvedValue([
        pgAttachment({addonId: 'a', addonName: 'pg-a', name: 'DATABASE'}),
        pgAttachment({addonId: 'a', addonName: 'pg-a', name: 'HEROKU_POSTGRESQL_RED'}),
        pgAttachment({
          addonId: 'b', addonName: 'pg-b', name: 'HEROKU_POSTGRESQL_BLUE', plan: 'heroku-postgresql:essential-0',
        }),
      ])
      const linkList = vi.fn(async (id: string) => (id === 'a' ? [LINK] : []))
      const ctx = buildCtx({attachmentListByApp, linkList})

      const result = await listByApp(ctx, 'app-1')

      expect(ctx.platform.addOnAttachment.resolution).not.toHaveBeenCalled()
      expect(result.map(r => [r.addon.name, r.addon.attachmentNames, r.links.length])).toEqual([
        ['pg-a', ['DATABASE', 'HEROKU_POSTGRESQL_RED'], 1],
        ['pg-b', ['HEROKU_POSTGRESQL_BLUE'], 0],
      ])
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

    it('throws before any request when the signal is already aborted', async () => {
      const ctx = buildCtx()
      const controller = new AbortController()
      controller.abort()

      await expect(listByApp(ctx, 'app-1', undefined, {signal: controller.signal})).rejects.toThrow()
      expect(ctx.platform.addOnAttachment.listByApp).not.toHaveBeenCalled()
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

    it('treats an empty database identity as DATABASE_URL', async () => {
      const ctx = buildCtx({linkCreate: vi.fn().mockResolvedValue(LINK)})

      await createForDatabase(ctx, 'app-1', '', 'redis-remote-1')

      expect(ctx.platform.addOnAttachment.resolution).toHaveBeenCalledWith({addon_attachment: 'DATABASE_URL', app: 'app-1'}) // eslint-disable-line camelcase
    })

    it.each([
      ['an add-on 404', () => Promise.reject(notFound('add_on'))],
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

    it.each([
      ['an app 404', () => notFound('app')],
      ['an ambiguous match', () => new AddonAmbiguousError([])],
      ['a server error', () => new Error('boom')],
    ])('does not retry the remote globally after %s', async (_label, makeError) => {
      const error = makeError()
      const addonResolution = vi.fn().mockRejectedValue(error)
      const ctx = buildCtx({addonResolution})

      await expect(createForDatabase(ctx, 'typo-app', 'other-app::DATABASE', 'redis-remote-1')).rejects.toBe(error)
      expect(addonResolution).toHaveBeenCalledOnce()
      expect(ctx.data.link.create).not.toHaveBeenCalled()
    })

    it('resolves an app::remote identity globally, once, even when it misses', async () => {
      const addonResolution = vi.fn().mockResolvedValue([])
      const ctx = buildCtx({addonResolution})

      await expect(createForDatabase(ctx, 'app-1', 'DATABASE', 'app-2::REDIS')).rejects.toBeInstanceOf(AddonNotFoundError)
      expect(addonResolution).toHaveBeenCalledOnce()
      expect(addonResolution).toHaveBeenCalledWith({addon: 'app-2::REDIS'})
    })

    it('rejects a remote that is not Postgres or Key-Value Store', async () => {
      const remote = remoteAddon({plan: 'papertrail:choklad'})
      const ctx = buildCtx({addonResolution: vi.fn().mockResolvedValue([remote])})

      const error = await createForDatabase(ctx, 'app-1', 'DATABASE', 'papertrail-1').catch(error_ => error_)

      expect(error).toBeInstanceOf(InvalidLinkRemoteError)
      expect(error.addon).toEqual(remote)
      expect(error.body).toEqual({id: 'invalid_link_remote', message: error.message})
      expect(ctx.data.link.create).not.toHaveBeenCalled()
    })

    it('rejects a remote whose service only shares a prefix with a linkable service', async () => {
      const ctx = buildCtx({addonResolution: vi.fn().mockResolvedValue([remoteAddon({plan: 'heroku-redisfoo:mini'})])})

      await expect(createForDatabase(ctx, 'app-1', 'DATABASE', 'x')).rejects.toBeInstanceOf(InvalidLinkRemoteError)
    })

    it('accepts a Postgres remote under an overridden Postgres service name', async () => {
      vi.stubEnv('HEROKU_POSTGRESQL_ADDON_NAME', 'heroku-postgresql-staging')
      const attachmentResolution = vi.fn().mockResolvedValue([pgAttachment({plan: 'heroku-postgresql-staging:standard-0'})])
      const addonResolution = vi.fn().mockResolvedValue([remoteAddon({name: 'pg-staging', plan: 'heroku-postgresql-staging:standard-0'})])
      const ctx = buildCtx({addonResolution, attachmentResolution, linkCreate: vi.fn().mockResolvedValue(LINK)})

      await createForDatabase(ctx, 'app-1', 'DATABASE', 'pg-staging')

      expect(ctx.data.link.create).toHaveBeenCalledWith('addon-1', {as: undefined, target: 'pg-staging'})
    })

    it('rejects an Essential-tier database', async () => {
      const ctx = buildCtx({attachmentResolution: vi.fn().mockResolvedValue([pgAttachment({plan: 'heroku-postgresql:essential-0'})])})

      const error = await createForDatabase(ctx, 'app-1', 'DATABASE', 'redis-remote-1').catch(error_ => error_)

      expect(error).toBeInstanceOf(EssentialDatabaseNotSupportedError)
      expect(error.addon.name).toBe('postgresql-db-1')
      expect(error.body).toEqual({id: 'essential_database_not_supported', message: error.message})
      expect(ctx.data.link.create).not.toHaveBeenCalled()
    })

    it('rejects an Essential-tier remote', async () => {
      const ctx = buildCtx({addonResolution: vi.fn().mockResolvedValue([remoteAddon({name: 'pg-mini', plan: 'heroku-postgresql:mini'})])})

      const error = await createForDatabase(ctx, 'app-1', 'DATABASE', 'pg-mini').catch(error_ => error_)

      expect(error).toBeInstanceOf(EssentialDatabaseNotSupportedError)
      expect(error.addon.name).toBe('pg-mini')
      expect(ctx.data.link.create).not.toHaveBeenCalled()
    })

    it('runs beforeCreate with both sides before the create', async () => {
      const ctx = buildCtx({linkCreate: vi.fn().mockResolvedValue(LINK)})
      const beforeCreate = vi.fn(() => {
        expect(ctx.data.link.create).not.toHaveBeenCalled()
      })

      await createForDatabase(ctx, 'app-1', 'DATABASE', 'redis-remote-1', {}, {beforeCreate})

      expect(beforeCreate).toHaveBeenCalledWith({addon: pgAttachment().addon, target: remoteAddon()})
      expect(ctx.data.link.create).toHaveBeenCalledOnce()
    })

    it('does not create when beforeCreate throws', async () => {
      const ctx = buildCtx()

      await expect(createForDatabase(ctx, 'app-1', 'DATABASE', 'redis-remote-1', {}, {
        beforeCreate() {
          throw new Error('nope')
        },
      })).rejects.toThrow('nope')
      expect(ctx.data.link.create).not.toHaveBeenCalled()
    })

    it('does not create when the signal aborts inside beforeCreate', async () => {
      const ctx = buildCtx()
      const controller = new AbortController()

      await expect(createForDatabase(ctx, 'app-1', 'DATABASE', 'redis-remote-1', {}, {
        beforeCreate() {
          controller.abort()
        },
        signal: controller.signal,
      })).rejects.toThrow()
      expect(ctx.data.link.create).not.toHaveBeenCalled()
    })

    it('binds the signal to both clients', async () => {
      const ctx = buildCtx({linkCreate: vi.fn().mockResolvedValue(LINK)})
      const controller = new AbortController()

      await createForDatabase(ctx, 'app-1', 'DATABASE', 'redis-remote-1', {}, {signal: controller.signal})

      expect(ctx.data.withOptions).toHaveBeenCalledWith({signal: controller.signal})
      expect(ctx.platform.withOptions).toHaveBeenCalledWith({signal: controller.signal})
    })
  })

  describe('deleteFromDatabase', () => {
    it('resolves the database and deletes the link by add-on id', async () => {
      const ctx = buildCtx({linkDelete: vi.fn().mockResolvedValue(LINK)})

      const result = await deleteFromDatabase(ctx, 'app-1', 'DATABASE', 'redis-link')

      expect(ctx.data.link.delete).toHaveBeenCalledWith('addon-1', 'redis-link')
      expect(result).toEqual({addon: pgAttachment().addon, link: LINK})
    })

    it('runs beforeDelete with the database and link name before deleting', async () => {
      const ctx = buildCtx()
      const beforeDelete = vi.fn(() => {
        expect(ctx.data.link.delete).not.toHaveBeenCalled()
      })

      await deleteFromDatabase(ctx, 'app-1', 'DATABASE', 'redis-link', {beforeDelete})

      expect(beforeDelete).toHaveBeenCalledWith({addon: pgAttachment().addon, link: 'redis-link'})
      expect(ctx.data.link.delete).toHaveBeenCalledOnce()
    })

    it('rejects an Essential-tier database before beforeDelete', async () => {
      const ctx = buildCtx({attachmentResolution: vi.fn().mockResolvedValue([pgAttachment({plan: 'heroku-postgresql:essential-1'})])})
      const beforeDelete = vi.fn()

      await expect(deleteFromDatabase(ctx, 'app-1', 'DATABASE', 'redis-link', {beforeDelete}))
        .rejects.toBeInstanceOf(EssentialDatabaseNotSupportedError)
      expect(beforeDelete).not.toHaveBeenCalled()
      expect(ctx.data.link.delete).not.toHaveBeenCalled()
    })

    it('does not delete when beforeDelete throws', async () => {
      const ctx = buildCtx()

      await expect(deleteFromDatabase(ctx, 'app-1', 'DATABASE', 'redis-link', {
        beforeDelete() {
          throw new Error('confirmation mismatch')
        },
      })).rejects.toThrow('confirmation mismatch')
      expect(ctx.data.link.delete).not.toHaveBeenCalled()
    })

    it('does not delete when the signal aborts inside beforeDelete', async () => {
      const ctx = buildCtx()
      const controller = new AbortController()

      await expect(deleteFromDatabase(ctx, 'app-1', 'DATABASE', 'redis-link', {
        beforeDelete() {
          controller.abort()
        },
        signal: controller.signal,
      })).rejects.toThrow()
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

    it('does not shadow any generated link route', () => {
      const extensionKeys = Object.keys(linkExtensions.factory({} as never))
      const routeKeys = Object.keys(routes.link)

      expect(routeKeys.length).toBeGreaterThan(0)
      expect(extensionKeys.filter(key => routeKeys.includes(key))).toEqual([])
    })

    it('exposes the extensions alongside the generated routes', () => {
      const sdk = new HerokuSDK({extensions: [linkExtensions]})

      expect(sdk.data.link.list).toBeTypeOf('function')
      expect(sdk.data.link.listByApp).toBeTypeOf('function')
      expect(sdk.data.link.createForDatabase).toBeTypeOf('function')
      expect(sdk.data.link.deleteFromDatabase).toBeTypeOf('function')
    })
  })
})
