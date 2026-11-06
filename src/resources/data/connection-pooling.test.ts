import {
  describe, expect, it, vi,
} from 'vitest'

import type {ResourceCtx} from '../../core/extend-resource.js'

import {HerokuSDK} from '../../index.js'
import {attach, connectionPoolingExtensions} from './connection-pooling.js'
import {EssentialDatabaseNotSupportedError} from './internal/postgres-utils.js'
import {PgDatabaseNotFoundError} from './internal/resolve-pg-database.js'

type Mock = ReturnType<typeof vi.fn>

function pgAttachment(plan = 'heroku-postgresql:standard-0') {
  return {
    addon: {
      app: {id: 'app-1-uuid', name: 'app-1'}, id: 'addon-1', name: 'postgresql-db-1', plan: {name: plan},
    },
    app: {id: 'app-1-uuid', name: 'app-1'},
    // eslint-disable-next-line camelcase
    config_vars: ['DATABASE_URL'],
    id: 'att-1',
    name: 'DATABASE',
  }
}

function buildCtx(opts: {attachmentResolution?: Mock; poolingCreate?: Mock; releaseList?: Mock} = {}) {
  const data: Record<string, unknown> = {
    connectionPooling: {create: opts.poolingCreate ?? vi.fn().mockResolvedValue({name: 'DATABASE_CONNECTION_POOL'})},
  }
  data.withOptions = vi.fn(() => data)

  const headers: Array<Record<string, string>> = []
  const platform: Record<string, unknown> = {
    addOnAttachment: {
      listByApp: vi.fn().mockResolvedValue([]),
      resolution: opts.attachmentResolution ?? vi.fn().mockResolvedValue([pgAttachment()]),
    },
    release: {list: opts.releaseList ?? vi.fn().mockResolvedValue([{version: 42}])},
    withHeaders: vi.fn((h: Record<string, string>) => {
      headers.push(h)
      return platform
    }),
    withOptions: vi.fn(() => platform),
  }

  return {
    ctx: {data, platform} as unknown as Pick<ResourceCtx, 'data' | 'platform'>,
    data: data as {connectionPooling: {create: Mock}; withOptions: Mock},
    headers,
    platform: platform as {release: {list: Mock}; withOptions: Mock},
  }
}

describe('connectionPooling resource', () => {
  describe('attach', () => {
    it('resolves DATABASE_URL by default and attaches a pool by add-on name', async () => {
      const {ctx, data} = buildCtx()

      const result = await attach(ctx, 'app-1')

      expect(data.connectionPooling.create).toHaveBeenCalledWith('postgresql-db-1', {app: 'app-1', credential: 'default', name: undefined})
      expect(result).toEqual({
        addon: pgAttachment().addon,
        attachment: {name: 'DATABASE_CONNECTION_POOL'},
        releaseVersion: 42,
      })
    })

    it('passes the database identity and the attachment name through', async () => {
      const attachmentResolution = vi.fn().mockResolvedValue([pgAttachment()])
      const {ctx, data} = buildCtx({attachmentResolution})

      await attach(ctx, 'app-1', 'other-app::HEROKU_POSTGRESQL_RED', {as: 'MY_POOL'})

      expect(attachmentResolution).toHaveBeenCalledWith({addon_attachment: 'HEROKU_POSTGRESQL_RED', app: 'other-app'}) // eslint-disable-line camelcase
      expect(data.connectionPooling.create).toHaveBeenCalledWith('postgresql-db-1', {app: 'app-1', credential: 'default', name: 'MY_POOL'})
    })

    it('fetches only the newest release via a Range header', async () => {
      const {ctx, headers, platform} = buildCtx()

      await attach(ctx, 'app-1')

      expect(headers).toContainEqual({Range: 'version ..; max=1, order=desc'})
      expect(platform.release.list).toHaveBeenCalledOnce()
      expect(platform.release.list).toHaveBeenCalledWith('app-1')
    })

    it('throws PgDatabaseNotFoundError when the database does not resolve', async () => {
      const {ctx, data} = buildCtx({attachmentResolution: vi.fn().mockResolvedValue([])})

      await expect(attach(ctx, 'app-1', 'NOPE')).rejects.toBeInstanceOf(PgDatabaseNotFoundError)
      expect(data.connectionPooling.create).not.toHaveBeenCalled()
    })

    it('rejects an Essential-tier database', async () => {
      const {ctx, data} = buildCtx({attachmentResolution: vi.fn().mockResolvedValue([pgAttachment('heroku-postgresql:essential-0')])})

      const error = await attach(ctx, 'app-1').catch(error_ => error_)

      expect(error).toBeInstanceOf(EssentialDatabaseNotSupportedError)
      expect(error.addon.name).toBe('postgresql-db-1')
      expect(data.connectionPooling.create).not.toHaveBeenCalled()
    })

    it('fires onResolved, then onAttached, then fetches the release', async () => {
      const order: string[] = []
      const {ctx, data, platform} = buildCtx()
      data.connectionPooling.create.mockImplementation(async () => {
        order.push('create')
        return {name: 'POOL'}
      })
      platform.release.list.mockImplementation(async () => {
        order.push('release')
        return [{version: 7}]
      })

      await attach(ctx, 'app-1', undefined, {}, {
        onAttached(attachment) {
          order.push(`onAttached:${attachment.name}`)
        },
        onResolved({addon}) {
          order.push(`onResolved:${addon.name}`)
        },
      })

      expect(order).toEqual(['onResolved:postgresql-db-1', 'create', 'onAttached:POOL', 'release'])
    })

    it('does not attach when onResolved throws', async () => {
      const {ctx, data} = buildCtx()

      await expect(attach(ctx, 'app-1', undefined, {}, {
        onResolved() {
          throw new Error('stop')
        },
      })).rejects.toThrow('stop')
      expect(data.connectionPooling.create).not.toHaveBeenCalled()
    })

    it('binds the signal to both clients', async () => {
      const {ctx, data, platform} = buildCtx()
      const controller = new AbortController()

      await attach(ctx, 'app-1', undefined, {}, {signal: controller.signal})

      expect(data.withOptions).toHaveBeenCalledWith({signal: controller.signal})
      expect(platform.withOptions).toHaveBeenCalledWith({signal: controller.signal})
    })
  })

  describe('registration', () => {
    it('declares service: data, resource: connectionPooling', () => {
      expect(connectionPoolingExtensions.service).toBe('data')
      expect(connectionPoolingExtensions.resource).toBe('connectionPooling')
    })

    it('keeps the generated connectionPooling routes alongside the extension', () => {
      const sdk = new HerokuSDK({extensions: [connectionPoolingExtensions]})

      expect(sdk.data.connectionPooling.create).toBeTypeOf('function')
      expect(sdk.data.connectionPooling.info).toBeTypeOf('function')
      expect(sdk.data.connectionPooling.attach).toBeTypeOf('function')
    })
  })
})
