import * as routes from '@heroku/types/data/routes'
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

/**
 * Builds a platform client whose `withOptions` / `withHeaders` return *derived*
 * clients that remember the signal and headers bound so far, so a test can tell
 * which client a request went through.
 */
function buildPlatform(opts: {attachmentResolution: Mock; releaseList: Mock}) {
  const releaseCalls: Array<{headers: Record<string, string>; signal?: AbortSignal}> = []

  function derive(state: {headers: Record<string, string>; signal?: AbortSignal}): Record<string, unknown> {
    return {
      addOnAttachment: {
        listByApp: vi.fn().mockResolvedValue([]),
        resolution: opts.attachmentResolution,
      },
      release: {
        list: vi.fn(async (app: string) => {
          releaseCalls.push(state)
          return opts.releaseList(app)
        }),
      },
      withHeaders: (headers: Record<string, string>) => derive({...state, headers: {...state.headers, ...headers}}),
      withOptions: ({signal}: {signal?: AbortSignal}) => derive({...state, signal}),
    }
  }

  return {platform: derive({headers: {}}), releaseCalls}
}

function buildCtx(opts: {attachmentResolution?: Mock; poolingCreate?: Mock; releaseList?: Mock} = {}) {
  const releaseList = opts.releaseList ?? vi.fn().mockResolvedValue([{version: 42}])
  const {platform, releaseCalls} = buildPlatform({
    attachmentResolution: opts.attachmentResolution ?? vi.fn().mockResolvedValue([pgAttachment()]),
    releaseList,
  })

  const create = opts.poolingCreate ?? vi.fn().mockResolvedValue({name: 'DATABASE_CONNECTION_POOL'})
  const data: Record<string, unknown> = {connectionPooling: {create}}
  data.withOptions = vi.fn(() => data)

  return {
    create,
    ctx: {data, platform} as unknown as Pick<ResourceCtx, 'data' | 'platform'>,
    data: data as {withOptions: Mock},
    releaseCalls,
    releaseList,
  }
}

describe('connectionPooling resource', () => {
  describe('attach', () => {
    it('resolves DATABASE_URL by default and attaches a pool by add-on name with the default credential', async () => {
      const {create, ctx} = buildCtx()

      const result = await attach(ctx, 'app-1')

      expect(create).toHaveBeenCalledWith('postgresql-db-1', {app: 'app-1', credential: 'default'})
      expect(result).toEqual({
        addon: pgAttachment().addon,
        attachment: {name: 'DATABASE_CONNECTION_POOL'},
        releaseVersion: 42,
      })
    })

    it('passes the database identity, name, and credential through', async () => {
      const attachmentResolution = vi.fn().mockResolvedValue([pgAttachment()])
      const {create, ctx} = buildCtx({attachmentResolution})

      await attach(ctx, 'app-1', 'other-app::HEROKU_POSTGRESQL_RED', {credential: 'reader', name: 'MY_POOL'})

      expect(attachmentResolution).toHaveBeenCalledWith({addon_attachment: 'HEROKU_POSTGRESQL_RED', app: 'other-app'}) // eslint-disable-line camelcase
      expect(create).toHaveBeenCalledWith('postgresql-db-1', {app: 'app-1', credential: 'reader', name: 'MY_POOL'})
    })

    it('fetches only the newest release through the client carrying the Range header', async () => {
      const {ctx, releaseCalls, releaseList} = buildCtx()

      await attach(ctx, 'app-1')

      expect(releaseList).toHaveBeenCalledOnce()
      expect(releaseList).toHaveBeenCalledWith('app-1')
      expect(releaseCalls[0].headers).toEqual({Range: 'version ..; max=1, order=desc'})
    })

    it('reports an undefined release version when there are no releases', async () => {
      const {ctx} = buildCtx({releaseList: vi.fn().mockResolvedValue([])})

      expect((await attach(ctx, 'app-1')).releaseVersion).toBeUndefined()
    })

    it('reports an undefined release version when the release lookup fails after attaching', async () => {
      const {ctx} = buildCtx({releaseList: vi.fn().mockRejectedValue(new Error('boom'))})

      const result = await attach(ctx, 'app-1')

      expect(result.attachment).toEqual({name: 'DATABASE_CONNECTION_POOL'})
      expect(result.releaseVersion).toBeUndefined()
    })

    it('throws PgDatabaseNotFoundError when the database does not resolve', async () => {
      const {create, ctx} = buildCtx({attachmentResolution: vi.fn().mockResolvedValue([])})

      await expect(attach(ctx, 'app-1', 'NOPE')).rejects.toBeInstanceOf(PgDatabaseNotFoundError)
      expect(create).not.toHaveBeenCalled()
    })

    it('rejects an Essential-tier database', async () => {
      const {create, ctx} = buildCtx({attachmentResolution: vi.fn().mockResolvedValue([pgAttachment('heroku-postgresql:essential-0')])})

      const error = await attach(ctx, 'app-1').catch(error_ => error_)

      expect(error).toBeInstanceOf(EssentialDatabaseNotSupportedError)
      expect(error.addon.name).toBe('postgresql-db-1')
      expect(create).not.toHaveBeenCalled()
    })

    it('runs onResolved with the add-on, then onAttached, then fetches the release', async () => {
      const order: string[] = []
      const {create, ctx, releaseList} = buildCtx()
      create.mockImplementation(async () => {
        order.push('create')
        return {name: 'POOL'}
      })
      releaseList.mockImplementation(async () => {
        order.push('release')
        return [{version: 7}]
      })

      await attach(ctx, 'app-1', undefined, {}, {
        onAttached(attachment) {
          order.push(`onAttached:${attachment.name}`)
        },
        onResolved(addon) {
          order.push(`onResolved:${addon.name}`)
        },
      })

      expect(order).toEqual(['onResolved:postgresql-db-1', 'create', 'onAttached:POOL', 'release'])
    })

    it('does not attach when onResolved throws', async () => {
      const {create, ctx} = buildCtx()

      await expect(attach(ctx, 'app-1', undefined, {}, {
        onResolved() {
          throw new Error('stop')
        },
      })).rejects.toThrow('stop')
      expect(create).not.toHaveBeenCalled()
    })

    it('does not attach when the signal aborts inside onResolved', async () => {
      const {create, ctx} = buildCtx()
      const controller = new AbortController()

      await expect(attach(ctx, 'app-1', undefined, {}, {
        onResolved() {
          controller.abort()
        },
        signal: controller.signal,
      })).rejects.toThrow()
      expect(create).not.toHaveBeenCalled()
    })

    it('skips the release lookup when onAttached throws', async () => {
      const {ctx, releaseList} = buildCtx()

      await expect(attach(ctx, 'app-1', undefined, {}, {
        onAttached() {
          throw new Error('ui failed')
        },
      })).rejects.toThrow('ui failed')
      expect(releaseList).not.toHaveBeenCalled()
    })

    it('binds the signal to the data client and to the release lookup', async () => {
      const {ctx, data, releaseCalls} = buildCtx()
      const controller = new AbortController()

      await attach(ctx, 'app-1', undefined, {}, {signal: controller.signal})

      expect(data.withOptions).toHaveBeenCalledWith({signal: controller.signal})
      expect(releaseCalls[0].signal).toBe(controller.signal)
    })
  })

  describe('registration', () => {
    it('declares service: data, resource: connectionPooling', () => {
      expect(connectionPoolingExtensions.service).toBe('data')
      expect(connectionPoolingExtensions.resource).toBe('connectionPooling')
    })

    it('does not shadow any generated connectionPooling route', () => {
      const extensionKeys = Object.keys(connectionPoolingExtensions.factory({} as never))
      const routeKeys = Object.keys(routes.connectionPooling)

      expect(routeKeys.length).toBeGreaterThan(0)
      expect(extensionKeys.filter(key => routeKeys.includes(key))).toEqual([])
    })

    it('exposes the extension alongside the generated routes', () => {
      const sdk = new HerokuSDK({extensions: [connectionPoolingExtensions]})

      expect(sdk.data.connectionPooling.create).toBeTypeOf('function')
      expect(sdk.data.connectionPooling.attach).toBeTypeOf('function')
    })
  })
})
