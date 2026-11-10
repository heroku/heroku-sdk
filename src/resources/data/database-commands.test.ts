/* eslint-disable camelcase */
import {HerokuApiClient} from '@heroku/heroku-fetch'
import * as routes from '@heroku/types/data/routes'
import {
  afterEach, describe, expect, it, vi,
} from 'vitest'

import type {ResourceCtx} from '../../core/extend-resource.js'

import {HerokuSDK} from '../../index.js'
import {
  DatabaseAlreadyPromotedError,
  databaseCommandExtensions,
  DatabaseNotFollowerError,
  DatabaseNotReadyError,
  DatabaseReleasePhaseError,
  promoteDatabase,
  resetDatabase,
  unfollowDatabase,
} from './database-commands.js'

afterEach(() => vi.restoreAllMocks())

const resolvedAttachment = {
  addon: {
    app: {id: 'app-id', name: 'test-app'},
    id: 'database-id',
    name: 'postgres-example',
    plan: {name: 'heroku-postgresql:essential-0'},
  },
  app: {id: 'app-id', name: 'test-app'},
  config_vars: ['DATABASE_URL'],
  created_at: '2024-01-01T00:00:00Z',
  id: 'attachment-id',
  log_input_url: null,
  name: 'DATABASE',
  namespace: null,
  updated_at: '2024-01-01T00:00:00Z',
  web_url: null,
}

function mockApiResponse(body: unknown): Response {
  return {
    headers: new Headers({'content-length': '100'}),
    json: vi.fn().mockResolvedValue(body),
    status: 200,
  } as unknown as Response
}

function buildCtx(opts: {
  attachmentCreate?: ReturnType<typeof vi.fn>
  attachmentDelete?: ReturnType<typeof vi.fn>
  attachmentsByApp?: ReturnType<typeof vi.fn>
  configVars?: ReturnType<typeof vi.fn>
  databaseInfo?: ReturnType<typeof vi.fn>
  databaseReset?: ReturnType<typeof vi.fn>
  databaseUnfollow?: ReturnType<typeof vi.fn>
  databaseWaitStatus?: ReturnType<typeof vi.fn>
  formationList?: ReturnType<typeof vi.fn>
  releaseInfo?: ReturnType<typeof vi.fn>
  releaseList?: ReturnType<typeof vi.fn>
  resolutionByAttachment?: ReturnType<typeof vi.fn>
} = {}): ResourceCtx {
  const data: Record<string, unknown> = {
    database: {
      info: opts.databaseInfo ?? vi.fn().mockResolvedValue({}),
      reset: opts.databaseReset ?? vi.fn().mockResolvedValue({message: 'reset'}),
      unfollow: opts.databaseUnfollow ?? vi.fn().mockResolvedValue({message: 'unfollowed'}),
      waitStatus: opts.databaseWaitStatus ?? vi.fn().mockResolvedValue({message: 'available', 'waiting?': false}),
    },
  }
  data.withOptions = vi.fn(() => data)

  const platform: Record<string, unknown> = {
    addOnAttachment: {
      create: opts.attachmentCreate ?? vi.fn().mockResolvedValue({name: 'DATABASE'}),
      delete: opts.attachmentDelete ?? vi.fn().mockResolvedValue({name: 'deleted'}),
      listByApp: opts.attachmentsByApp ?? vi.fn().mockResolvedValue([]),
      resolution: opts.resolutionByAttachment ?? vi.fn().mockResolvedValue([resolvedAttachment]),
    },
    configVar: {infoForApp: opts.configVars ?? vi.fn().mockResolvedValue({})},
    formation: {list: opts.formationList ?? vi.fn().mockResolvedValue([])},
    release: {
      info: opts.releaseInfo ?? vi.fn().mockResolvedValue({status: 'succeeded'}),
      list: opts.releaseList ?? vi.fn().mockResolvedValue([]),
    },
  }
  platform.withHeaders = vi.fn(() => platform)
  platform.withOptions = vi.fn(() => platform)

  return {
    data: data as never,
    platform: platform as never,
  }
}

describe('database command extensions', () => {
  it('resolves the raw database identity and resets with sorted, lowercase extensions', async () => {
    const resolutionByAttachment = vi.fn().mockResolvedValue([resolvedAttachment])
    const databaseReset = vi.fn().mockResolvedValue({message: 'reset'})
    const ctx = buildCtx({databaseReset, resolutionByAttachment})

    const result = await resetDatabase(ctx, 'test-app', 'POSTGRES_URL', {
      extensions: 'uuid-ossp, Postgis',
    })

    expect(resolutionByAttachment).toHaveBeenCalledExactlyOnceWith({
      addon_attachment: 'POSTGRES_URL',
      app: 'test-app',
    })
    expect(databaseReset).toHaveBeenCalledExactlyOnceWith('database-id', {
      extensions: ['postgis', 'uuid-ossp'],
    })
    expect(result).toEqual({addon: resolvedAttachment.addon, result: {message: 'reset'}})
  })

  it('uses an empty reset body when extensions are omitted', async () => {
    const databaseReset = vi.fn().mockResolvedValue({message: 'reset'})
    const ctx = buildCtx({databaseReset})

    await resetDatabase(ctx, 'test-app')

    expect(databaseReset).toHaveBeenCalledExactlyOnceWith('database-id', {})
  })

  it('calls beforeReset with the resolved add-on before the reset request', async () => {
    const events: string[] = []
    const databaseReset = vi.fn(async () => {
      events.push('reset')
      return {message: 'reset'}
    })
    const beforeReset = vi.fn(async ({addon}) => {
      events.push(`before:${addon.name}`)
    })

    await resetDatabase(buildCtx({databaseReset}), 'test-app', undefined, {beforeReset})

    expect(beforeReset).toHaveBeenCalledExactlyOnceWith({addon: resolvedAttachment.addon, appIdentity: 'test-app'})
    expect(events).toEqual(['before:postgres-example', 'reset'])
  })

  it('aborts reset if the confirmation callback cancels the signal', async () => {
    const databaseReset = vi.fn()
    const controller = new AbortController()

    await expect(resetDatabase(buildCtx({databaseReset}), 'test-app', undefined, {
      beforeReset() {
        controller.abort()
      },
      signal: controller.signal,
    })).rejects.toThrow()

    expect(databaseReset).not.toHaveBeenCalled()
  })

  it('does not reset if beforeReset rejects', async () => {
    const databaseReset = vi.fn()
    const failure = new Error('confirmation declined')

    await expect(resetDatabase(buildCtx({databaseReset}), 'test-app', undefined, {
      beforeReset() {
        throw failure
      },
    })).rejects.toBe(failure)

    expect(databaseReset).not.toHaveBeenCalled()
  })

  it('threads the abort signal into resolution and the in-flight reset request', async () => {
    const resolutionByAttachment = vi.fn().mockResolvedValue([resolvedAttachment])
    const databaseReset = vi.fn().mockResolvedValue({message: 'reset'})
    const ctx = buildCtx({databaseReset, resolutionByAttachment})
    const controller = new AbortController()

    await resetDatabase(ctx, 'test-app', undefined, {signal: controller.signal})

    expect(ctx.platform.withOptions).toHaveBeenCalledWith({signal: controller.signal})
    expect((ctx.data as unknown as {withOptions: ReturnType<typeof vi.fn>}).withOptions)
      .toHaveBeenCalledWith({signal: controller.signal})
    expect(databaseReset).toHaveBeenCalledExactlyOnceWith('database-id', {})
  })

  it('does no work when already aborted', async () => {
    const resolutionByAttachment = vi.fn()
    const databaseReset = vi.fn()
    const ctx = buildCtx({databaseReset, resolutionByAttachment})

    await expect(resetDatabase(ctx, 'test-app', undefined, {signal: AbortSignal.abort()})).rejects.toThrow()

    expect(resolutionByAttachment).not.toHaveBeenCalled()
    expect(databaseReset).not.toHaveBeenCalled()
  })

  it('does not reset if database resolution fails and propagates API errors', async () => {
    const resolutionError = new Error('could not resolve')
    const databaseReset = vi.fn()
    const resolveFailureCtx = buildCtx({
      databaseReset,
      resolutionByAttachment: vi.fn().mockRejectedValue(resolutionError),
    })
    await expect(resetDatabase(resolveFailureCtx, 'test-app')).rejects.toBe(resolutionError)
    expect(databaseReset).not.toHaveBeenCalled()

    const resetError = new Error('reset failed')
    const requestCtx = buildCtx({databaseReset: vi.fn().mockRejectedValue(resetError)})
    await expect(resetDatabase(requestCtx, 'test-app')).rejects.toBe(resetError)
  })

  it('promotes after alias safety/readiness checks and creates a pooler for the new leader', async () => {
    const events: string[] = []
    const current = {...resolvedAttachment, addon: {...resolvedAttachment.addon, id: 'old-id', name: 'old-postgres'}, name: 'DATABASE'}
    const backup = {...current, id: 'backup-id', name: 'RED'}
    const pooler = {
      ...current, id: 'pool-id', name: 'DATABASE_CONNECTION_POOL', namespace: 'connection-pooling:default',
    }
    const attachmentCreate = vi.fn(async () => {
      events.push('create')
      return attachmentCreate.mock.calls.length === 1
        ? backup
        : (attachmentCreate.mock.calls.length === 2 ? {...resolvedAttachment, name: 'DATABASE'} : {...pooler, addon: resolvedAttachment.addon})
    })
    const databaseInfo = vi.fn(async () => {
      events.push('info')
      return {following: null}
    })
    const databaseWaitStatus = vi.fn(async () => {
      events.push('ready')
      return {message: 'available', 'waiting?': false}
    })
    const attachmentsByApp = vi.fn().mockResolvedValue([current, pooler])
    const ctx = buildCtx({
      attachmentCreate, attachmentsByApp, databaseInfo, databaseWaitStatus,
    })
    const calls: string[] = []

    const result = await promoteDatabase(ctx, 'test-app', 'DATABASE_URL', {
      as: 'CUSTOM_DB',
      beforePromote() {
        calls.push('confirm')
        events.push('confirm')
      },
    })

    expect(calls).toEqual(['confirm'])
    expect(events).toEqual(['confirm', 'create', 'ready', 'create', 'create', 'info'])
    expect(databaseWaitStatus).toHaveBeenCalledExactlyOnceWith('database-id')
    expect(attachmentCreate).toHaveBeenNthCalledWith(1, {
      addon: current.addon.name,
      app: 'test-app',
      confirm: 'test-app',
      namespace: null,
    })
    expect(attachmentCreate).toHaveBeenNthCalledWith(2, {
      addon: resolvedAttachment.addon.name,
      app: 'test-app',
      confirm: 'test-app',
      name: 'CUSTOM_DB',
      namespace: null,
    })
    expect(ctx.platform.addOnAttachment.delete).not.toHaveBeenCalled()
    expect(attachmentCreate).toHaveBeenNthCalledWith(3, {
      addon: resolvedAttachment.addon.name,
      app: 'test-app',
      confirm: 'test-app',
      name: 'DATABASE_CONNECTION_POOL',
      namespace: 'connection-pooling:default',
    })
    expect(databaseInfo).toHaveBeenCalledExactlyOnceWith('database-id')
    expect(result.backupAttachment).toEqual(backup)
    expect(result.poolerAttachment).toEqual({...pooler, addon: resolvedAttachment.addon})
  })

  it('does not create a duplicate alias for current DATABASE when same database has an alias', async () => {
    const oldAddon = {...resolvedAttachment.addon, id: 'old-database-id', name: 'old-postgres'}
    const current = {...resolvedAttachment, addon: oldAddon, name: 'DATABASE'}
    const alias = {...resolvedAttachment, addon: oldAddon, name: 'RED'}
    const attachmentsByApp = vi.fn().mockResolvedValue([current, alias])
    const attachmentCreate = vi.fn()
    const ctx = buildCtx({attachmentCreate, attachmentsByApp})

    await promoteDatabase(ctx, 'test-app')

    expect(attachmentCreate).toHaveBeenCalledExactlyOnceWith({
      addon: resolvedAttachment.addon.name,
      app: 'test-app',
      confirm: 'test-app',
      name: 'DATABASE',
      namespace: null,
    })
  })

  it('reports a newly-created backup alias before later readiness failures', async () => {
    const addon = {...resolvedAttachment.addon, id: 'old-id', name: 'old-postgres'}
    const current = {
      ...resolvedAttachment, addon, name: 'DATABASE', namespace: undefined,
    }
    const alias = {
      ...resolvedAttachment, addon, name: 'RED', namespace: null,
    }
    const backup = {...current, id: 'backup-id', name: 'RED'}
    const attachmentCreate = vi.fn().mockResolvedValue(backup)
    const onBackupAttachment = vi.fn()
    const ctx = buildCtx({
      attachmentCreate,
      attachmentsByApp: vi.fn().mockResolvedValue([current, alias]),
      databaseWaitStatus: vi.fn().mockResolvedValue({message: 'pending', 'waiting?': true}),
    })

    await expect(promoteDatabase(ctx, 'test-app', undefined, {onBackupAttachment}))
      .rejects.toBeInstanceOf(DatabaseNotReadyError)

    expect(attachmentCreate).toHaveBeenCalledOnce()
    expect(onBackupAttachment).toHaveBeenCalledExactlyOnceWith(backup)
  })

  it('rejects promoting the same attachment and does no mutation', async () => {
    const attachmentCreate = vi.fn()
    const current = {...resolvedAttachment, name: 'DATABASE'}
    const attachmentsByApp = vi.fn().mockResolvedValue([
      {...current, addon: {...current.addon, plan: {name: 'heroku-postgresql:essential-0'}}},
    ])
    const ctx = buildCtx({attachmentCreate, attachmentsByApp})

    await expect(promoteDatabase(ctx, 'test-app'))
      .rejects.toBeInstanceOf(DatabaseAlreadyPromotedError)
    expect(attachmentCreate).not.toHaveBeenCalled()
  })

  it('does not run beforePromote mutation steps when database is not ready', async () => {
    const beforePromote = vi.fn()
    const attachmentCreate = vi.fn()
    const status = {message: 'pending', 'waiting?': true}
    const ctx = buildCtx({
      attachmentCreate,
      attachmentsByApp: vi.fn().mockResolvedValue([]),
      databaseWaitStatus: vi.fn().mockResolvedValue(status),
    })

    const error = await promoteDatabase(ctx, 'test-app', undefined, {beforePromote}).catch(error_ => error_)

    expect(error).toBeInstanceOf(DatabaseNotReadyError)
    expect(error.status).toEqual(status)
    expect(error.status.message).toBe('pending')
    expect(error.status['waiting?']).toBe(true)
    expect(error.message).toBe('Database cannot be promoted while in state: pending')
    expect(beforePromote).toHaveBeenCalledOnce()
    expect(attachmentCreate).not.toHaveBeenCalled()
  })

  it('skips readiness when force is set and aborts before mutation in beforePromote callback', async () => {
    const databaseWaitStatus = vi.fn()
    const attachmentCreate = vi.fn()
    const forceCtx = buildCtx({attachmentCreate, attachmentsByApp: vi.fn().mockResolvedValue([]), databaseWaitStatus})
    await promoteDatabase(forceCtx, 'test-app', undefined, {force: true})
    expect(databaseWaitStatus).not.toHaveBeenCalled()

    const controller = new AbortController()
    const callbackAttachmentCreate = vi.fn()
    const callbackAttachmentDelete = vi.fn()
    const callbackDatabaseWaitStatus = vi.fn()
    const noMutationCtx = buildCtx({
      attachmentCreate: callbackAttachmentCreate,
      attachmentDelete: callbackAttachmentDelete,
      attachmentsByApp: vi.fn().mockResolvedValue([]),
      databaseWaitStatus: callbackDatabaseWaitStatus,
    })
    await expect(promoteDatabase(noMutationCtx, 'test-app', undefined, {
      beforePromote() {
        controller.abort()
      },
      signal: controller.signal,
    })).rejects.toThrow()
    expect(callbackAttachmentCreate).not.toHaveBeenCalled()
    expect(callbackAttachmentDelete).not.toHaveBeenCalled()
    expect(callbackDatabaseWaitStatus).not.toHaveBeenCalled()
  })

  it('records follower state and polls the release-phase attach/detach statuses', async () => {
    const releases = [
      {description: 'Attach DATABASE', id: 'attach-release'},
      {description: 'Detach DATABASE', id: 'detach-release'},
    ]
    const releaseList = vi.fn().mockResolvedValue(releases)
    const releaseInfo = vi.fn()
      .mockResolvedValueOnce({id: 'attach-release', status: 'succeeded'})
      .mockResolvedValueOnce({id: 'detach-release', status: 'failed'})
    const databaseInfo = vi.fn().mockResolvedValue({following: 'postgres://leader/db', leader: 'leader'})
    const platform = buildCtx({
      databaseInfo, formationList: vi.fn().mockResolvedValue([{type: 'release'}]), releaseInfo, releaseList,
    })
    const result = await promoteDatabase(platform, 'test-app')

    expect(platform.platform.withHeaders).toHaveBeenCalledWith({Range: 'version ..; max=5, order=desc'})
    expect(releaseInfo).toHaveBeenNthCalledWith(1, 'test-app', 'attach-release')
    expect(releaseInfo).toHaveBeenNthCalledWith(2, 'test-app', 'detach-release')
    expect(result.database.following).toBe('postgres://leader/db')
    expect(result.releasePhase).toEqual({
      attach: {id: 'attach-release', status: 'succeeded'},
      detach: {id: 'detach-release', status: 'failed'},
      status: 'succeeded',
    })
  })

  it('fails release-phase checks when required attach/detach releases are missing', async () => {
    const ctx = buildCtx({
      attachmentsByApp: vi.fn().mockResolvedValue([]),
      formationList: vi.fn().mockResolvedValue([{type: 'release'}]),
      releaseList: vi.fn().mockResolvedValue([]),
    })

    await expect(promoteDatabase(ctx, 'test-app', undefined, {force: true}))
      .rejects.toBeInstanceOf(DatabaseReleasePhaseError)
  })

  it('resolves follower display information before callback, then sends typed unfollow request', async () => {
    const databaseInfo = vi.fn().mockResolvedValue({following: 'postgres://host:5432/db'})
    const configVars = vi.fn().mockResolvedValue({DATABASE_URL: 'postgres://other/db', LEADER_URL: 'postgres://host:5432/db'})
    const databaseUnfollow = vi.fn().mockResolvedValue({message: 'unfollowed'})
    const ctx = buildCtx({configVars, databaseInfo, databaseUnfollow})
    const beforeUnfollow = vi.fn()

    const result = await unfollowDatabase(ctx, 'test-app', 'FOLLOWER_URL', {beforeUnfollow})

    expect(configVars).toHaveBeenCalledExactlyOnceWith('test-app')
    expect(beforeUnfollow).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      addon: resolvedAttachment.addon,
      appIdentity: 'test-app',
      following: 'postgres://host:5432/db',
      origin: 'LEADER',
    }))
    expect(databaseUnfollow).toHaveBeenCalledExactlyOnceWith('database-id')
    expect(result.origin).toBe('LEADER')
    expect(result.result).toEqual({message: 'unfollowed'})
  })

  it('rejects unfollow for non-followers and honors callback failure/cancellation', async () => {
    const databaseUnfollow = vi.fn()
    const notFollowerCtx = buildCtx({databaseInfo: vi.fn().mockResolvedValue({following: null}), databaseUnfollow})
    await expect(unfollowDatabase(notFollowerCtx, 'test-app')).rejects.toBeInstanceOf(DatabaseNotFollowerError)
    expect(notFollowerCtx.platform.configVar.infoForApp).not.toHaveBeenCalled()
    expect(databaseUnfollow).not.toHaveBeenCalled()

    const failure = new Error('confirmation declined')
    const callbackCtx = buildCtx({
      configVars: vi.fn().mockResolvedValue({}),
      databaseInfo: vi.fn().mockResolvedValue({following: 'postgres://host:5432/db'}),
      databaseUnfollow,
    })
    await expect(unfollowDatabase(callbackCtx, 'test-app', undefined, {
      beforeUnfollow() {
        throw failure
      },
    })).rejects.toBe(failure)
    expect(databaseUnfollow).not.toHaveBeenCalled()

    const controller = new AbortController()
    const cancelCtx = buildCtx({
      configVars: vi.fn().mockResolvedValue({}),
      databaseInfo: vi.fn().mockResolvedValue({following: 'postgres://host:5432/db'}),
      databaseUnfollow,
    })
    await expect(unfollowDatabase(cancelCtx, 'test-app', undefined, {
      beforeUnfollow() {
        controller.abort()
      },
      signal: controller.signal,
    })).rejects.toThrow()
    expect(databaseUnfollow).not.toHaveBeenCalled()
  })

  it('exports and delegates app-level commands through the standalone extension bundle', async () => {
    expect(databaseCommandExtensions.service).toBe('data')
    expect(databaseCommandExtensions.resource).toBe('database')
    const databaseInfo = vi.fn().mockResolvedValue({following: 'postgres://host:5432/db'})
    const databaseUnfollow = vi.fn().mockResolvedValue({message: 'unfollowed'})
    const resolutionByAttachment = vi.fn().mockResolvedValue([resolvedAttachment])
    const ctx = buildCtx({
      configVars: vi.fn().mockResolvedValue({}),
      databaseInfo,
      databaseUnfollow,
      resolutionByAttachment,
    })
    const methods = databaseCommandExtensions.factory(ctx)
    expect(Object.keys(methods)).toEqual(['promote', 'resetForApp', 'unfollowForApp'])

    await methods.resetForApp('test-app', 'DB_URL', {extensions: ['Postgis']})
    expect(ctx.data.database.reset).toHaveBeenCalledExactlyOnceWith('database-id', {extensions: ['postgis']})

    await methods.unfollowForApp('test-app', 'FOLLOWER_URL')
    expect(resolutionByAttachment).toHaveBeenNthCalledWith(2, {
      addon_attachment: 'FOLLOWER_URL',
      app: 'test-app',
    })
    expect(databaseInfo).toHaveBeenCalledExactlyOnceWith('database-id')
    expect(databaseUnfollow).toHaveBeenCalledExactlyOnceWith('database-id')
  })

  it('does not shadow any generated database route', () => {
    const extensionKeys = Object.keys(databaseCommandExtensions.factory({} as never))
    const routeKeys = Object.keys(routes.database)

    expect(routeKeys.length).toBeGreaterThan(0)
    expect(extensionKeys.filter(key => routeKeys.includes(key))).toEqual([])
  })

  it('dispatches generated reset and unfollow methods while exposing app-level composites', async () => {
    const requests: Array<{body?: unknown; method: string; path: string}> = []
    vi.spyOn(HerokuApiClient.prototype, 'post').mockImplementation(async (path, body) => {
      requests.push({body, method: 'POST', path})
      return mockApiResponse([resolvedAttachment])
    })
    vi.spyOn(HerokuApiClient.prototype, 'get').mockImplementation(async path => {
      requests.push({method: 'GET', path})
      return mockApiResponse(path.endsWith('/config-vars')
        ? {FOLLOWER_URL: 'postgres://host:5432/db'}
        : {following: 'postgres://host:5432/db'})
    })
    vi.spyOn(HerokuApiClient.prototype, 'put').mockImplementation(async (path, body) => {
      requests.push({body, method: 'PUT', path})
      return mockApiResponse({message: 'done'})
    })
    const sdk = new HerokuSDK({extensions: [databaseCommandExtensions]})

    expect(sdk.data.database.reset).toBeTypeOf('function')
    expect(sdk.data.database.unfollow).toBeTypeOf('function')
    expect(sdk.data.database.resetForApp).toBeTypeOf('function')
    expect(sdk.data.database.unfollowForApp).toBeTypeOf('function')

    await sdk.data.database.reset('database-id', {extensions: ['postgis']})
    await sdk.data.database.unfollow('database-id')
    await sdk.data.database.resetForApp('test-app', 'DATABASE_URL', {extensions: ['postgis']})
    await sdk.data.database.unfollowForApp('test-app', 'FOLLOWER_URL')

    expect(requests).toEqual([
      {body: {extensions: ['postgis']}, method: 'PUT', path: '/client/v11/databases/database-id/reset'},
      {method: 'PUT', path: '/client/v11/databases/database-id/unfollow'},
      {
        body: {addon_attachment: 'DATABASE_URL', app: 'test-app'},
        method: 'POST',
        path: '/actions/addon-attachments/resolve',
      },
      {body: {extensions: ['postgis']}, method: 'PUT', path: '/client/v11/databases/database-id/reset'},
      {
        body: {addon_attachment: 'FOLLOWER_URL', app: 'test-app'},
        method: 'POST',
        path: '/actions/addon-attachments/resolve',
      },
      {method: 'GET', path: '/client/v11/databases/database-id'},
      {method: 'GET', path: '/apps/test-app/config-vars'},
      {method: 'PUT', path: '/client/v11/databases/database-id/unfollow'},
    ])
  })
})
