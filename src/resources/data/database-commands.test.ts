/* eslint-disable camelcase */
import {HerokuApiClient} from '@heroku/heroku-fetch'
import * as routes from '@heroku/types/data/routes'
import {
  afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest'

import type {ResourceCtx} from '../../core/extend-resource.js'

import {HerokuSDK} from '../../index.js'
import {
  DatabaseAlreadyPromotedError,
  databaseCommandExtensions,
  DatabaseNotFollowerError,
  DatabaseNotReadyError,
  DatabasePromotionError,
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
  operationSignal?: AbortSignal
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
    operationSignal: opts.operationSignal,
    platform: platform as never,
  }
}

function capturePlatformRequestSignals(ctx: ResourceCtx): AbortSignal[] {
  const signals: AbortSignal[] = []
  const platform = ctx.platform as unknown as {
    withOptions: (options: {signal?: AbortSignal}) => unknown
  }
  platform.withOptions = vi.fn((options: {signal?: AbortSignal}) => {
    if (options.signal) signals.push(options.signal)
    return ctx.platform
  })
  return signals
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

  it('aborts reset if the SDK operation signal is cancelled in the callback', async () => {
    const databaseReset = vi.fn()
    const operationController = new AbortController()
    const reason = new Error('SDK operation cancelled')

    await expect(resetDatabase(buildCtx({databaseReset, operationSignal: operationController.signal}), 'test-app', undefined, {
      beforeReset() {
        operationController.abort(reason)
      },
    })).rejects.toBe(reason)

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

  it.each(['operation', 'caller'] as const)(
    'aborts an in-flight reset request when the %s signal is cancelled',
    async abortSource => {
      const operationController = new AbortController()
      const callerController = new AbortController()
      const ctx = buildCtx({operationSignal: operationController.signal})
      const requestSignals: AbortSignal[] = []
      const data = ctx.data as unknown as {
        withOptions: ReturnType<typeof vi.fn>
      }
      data.withOptions.mockImplementation((options: {signal?: AbortSignal}) => {
        if (options.signal) requestSignals.push(options.signal)

        return ctx.data
      })
      let markRequestStarted!: () => void
      const requestStarted = new Promise<void>(resolve => {
        markRequestStarted = resolve
      })
      const databaseReset = vi.fn((_id: string, _body: unknown) => new Promise<never>((_resolve, reject) => {
        markRequestStarted()
        const requestSignal = requestSignals.at(-1)
        if (!requestSignal) {
          reject(new Error('reset request signal was not bound'))
          return
        }

        requestSignal.addEventListener('abort', () => reject(requestSignal.reason), {once: true})
      }))
      ctx.data.database.reset = databaseReset as never
      const reason = new Error(`${abortSource} cancellation`)

      const promise = resetDatabase(ctx, 'test-app', undefined, {signal: callerController.signal})
      const expectation = expect(promise).rejects.toBe(reason)
      await requestStarted
      const effectiveSignal = requestSignals.at(-1)
      expect(effectiveSignal).toBeDefined()
      expect(effectiveSignal).not.toBe(operationController.signal)
      expect(effectiveSignal).not.toBe(callerController.signal)

      const abortingController = abortSource === 'operation' ? operationController : callerController
      const otherController = abortSource === 'operation' ? callerController : operationController
      abortingController.abort(reason)
      await expectation

      expect(effectiveSignal?.aborted).toBe(true)
      expect(otherController.signal.aborted).toBe(false)
      expect(databaseReset).toHaveBeenCalledExactlyOnceWith('database-id', {})
    },
  )

  it('does no reset work when the SDK operation signal is already aborted', async () => {
    const resolutionByAttachment = vi.fn()
    const databaseReset = vi.fn()
    const ctx = buildCtx({
      databaseReset,
      operationSignal: AbortSignal.abort(),
      resolutionByAttachment,
    })

    await expect(resetDatabase(ctx, 'test-app')).rejects.toThrow()

    expect(resolutionByAttachment).not.toHaveBeenCalled()
    expect(databaseReset).not.toHaveBeenCalled()
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
    expect(events).toEqual(['ready', 'confirm', 'create', 'create', 'create', 'info'])
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

  it('emits typed progress around attachment, pooler, and release-phase work', async () => {
    const current = {
      ...resolvedAttachment,
      addon: {...resolvedAttachment.addon, id: 'old-id', name: 'old-postgres'},
      name: 'DATABASE',
    }
    const pooler = {
      ...current, name: 'DATABASE_CONNECTION_POOL', namespace: 'connection-pooling:default',
    }
    const attachmentCreate = vi.fn()
      .mockResolvedValueOnce({...current, id: 'backup-id', name: 'RED'})
      .mockResolvedValueOnce({...resolvedAttachment, id: 'promoted-id'})
      .mockResolvedValueOnce({...pooler, addon: resolvedAttachment.addon})
    const releaseInfo = vi.fn()
      .mockResolvedValueOnce({id: 'attach-release', status: 'pending'})
      .mockResolvedValueOnce({id: 'attach-release', status: 'succeeded'})
      .mockResolvedValueOnce({id: 'detach-release', status: 'succeeded'})
    const onProgress = vi.fn()
    const ctx = buildCtx({
      attachmentCreate,
      attachmentsByApp: vi.fn().mockResolvedValue([current, pooler]),
      formationList: vi.fn().mockResolvedValue([{type: 'release'}]),
      releaseInfo,
      releaseList: vi.fn().mockResolvedValue([
        {description: 'Attach DATABASE', id: 'attach-release'},
        {description: 'Detach DATABASE', id: 'detach-release'},
      ]),
    })

    const result = await promoteDatabase(ctx, 'test-app', undefined, {
      force: true,
      onProgress,
      releasePhasePollIntervalMs: 1,
    })

    expect(result.releasePhase?.status).toBe('succeeded')
    expect(onProgress.mock.calls.map(([event]) => `${event.type}:${event.stage}:${event.status ?? '-'}`)).toEqual([
      'attachment:backup:started',
      'attachment:backup:succeeded',
      'attachment:promotion:started',
      'attachment:promotion:succeeded',
      'pooler-reattachment:reattachment:started',
      'pooler-reattachment:reattachment:succeeded',
      'database:resolved:-',
      'release-phase:started:started',
      'release-phase:poll:pending',
      'release-phase:poll:succeeded',
      'release-phase:completed:succeeded',
    ])
  })

  it('ignores progress callback failures without changing completed promotion outcome', async () => {
    const failure = new Error('progress observer failed')
    const attachment = {...resolvedAttachment, id: 'promoted-id'}
    const attachmentCreate = vi.fn().mockResolvedValue(attachment)
    const onProgress = vi.fn(() => Promise.reject(failure))

    const result = await promoteDatabase(buildCtx({attachmentCreate}), 'test-app', undefined, {
      force: true,
      onProgress,
    })

    expect(result.attachment).toEqual(attachment)
    expect(result.mutationStatus.attachment).toEqual({attempted: true, status: 'created'})
    expect(attachmentCreate).toHaveBeenCalledOnce()
    expect(onProgress).toHaveBeenCalled()
  })

  it('does not wait for a stalled progress observer before mutating', async () => {
    const attachment = {...resolvedAttachment, id: 'promoted-id'}
    const attachmentCreate = vi.fn().mockResolvedValue(attachment)
    const onProgress = vi.fn(() => new Promise<void>(() => {}))

    const result = await promoteDatabase(buildCtx({attachmentCreate}), 'test-app', undefined, {
      force: true,
      onProgress,
    })

    expect(result.attachment).toEqual(attachment)
    expect(attachmentCreate).toHaveBeenCalledOnce()
    expect(onProgress).toHaveBeenCalled()
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

  it('checks readiness before creating a backup alias or invoking beforePromote', async () => {
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
    const beforePromote = vi.fn()
    const ctx = buildCtx({
      attachmentCreate,
      attachmentsByApp: vi.fn().mockResolvedValue([current, alias]),
      databaseWaitStatus: vi.fn().mockResolvedValue({message: 'pending', 'waiting?': true}),
    })

    await expect(promoteDatabase(ctx, 'test-app', undefined, {beforePromote, onBackupAttachment}))
      .rejects.toBeInstanceOf(DatabaseNotReadyError)

    expect(attachmentCreate).not.toHaveBeenCalled()
    expect(onBackupAttachment).not.toHaveBeenCalled()
    expect(beforePromote).not.toHaveBeenCalled()
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

  it('checks readiness before running beforePromote', async () => {
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
    expect(beforePromote).not.toHaveBeenCalled()
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
    expect(callbackDatabaseWaitStatus).toHaveBeenCalledExactlyOnceWith('database-id')
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

  describe('release-phase polling outcomes', () => {
    beforeEach(() => vi.useFakeTimers())
    afterEach(() => {
      vi.clearAllTimers()
      vi.useRealTimers()
    })

    it('returns failed when the attach release fails', async () => {
      const attach = {id: 'attach-release', status: 'failed'}
      const detach = {id: 'detach-release', status: 'succeeded'}
      const releaseInfo = vi.fn()
        .mockResolvedValueOnce(attach)
        .mockResolvedValueOnce(detach)
      const ctx = buildCtx({
        formationList: vi.fn().mockResolvedValue([{type: 'release'}]),
        releaseInfo,
        releaseList: vi.fn().mockResolvedValue([
          {description: 'Attach DATABASE', id: 'attach-release'},
          {description: 'Detach DATABASE', id: 'detach-release'},
        ]),
      })

      const result = await promoteDatabase(ctx, 'test-app', undefined, {force: true})

      expect(releaseInfo).toHaveBeenNthCalledWith(1, 'test-app', 'attach-release')
      expect(releaseInfo).toHaveBeenNthCalledWith(2, 'test-app', 'detach-release')
      expect(result.releasePhase).toEqual({attach, detach, status: 'failed'})
    })

    it('returns timed_out when attach remains pending through releasePhaseTimeoutMs', async () => {
      const attachRelease = {description: 'Attach DATABASE', id: 'attach-release'}
      const releaseInfo = vi.fn(() => new Promise<never>(() => {}))
      const ctx = buildCtx({
        formationList: vi.fn().mockResolvedValue([{type: 'release'}]),
        releaseInfo,
        releaseList: vi.fn().mockResolvedValue([
          attachRelease,
          {description: 'Detach DATABASE', id: 'detach-release'},
        ]),
      })
      let settled = false
      const promise = promoteDatabase(ctx, 'test-app', undefined, {
        force: true,
        releasePhasePollIntervalMs: 10,
        releasePhaseTimeoutMs: 20,
      }).then(result => {
        settled = true
        return result
      })

      await vi.advanceTimersByTimeAsync(0)
      expect(releaseInfo).toHaveBeenCalledTimes(1)
      await vi.advanceTimersByTimeAsync(19)
      expect(settled).toBe(false)
      expect(releaseInfo).toHaveBeenCalledOnce()

      await vi.advanceTimersByTimeAsync(1)
      await vi.advanceTimersByTimeAsync(0)
      expect(settled).toBe(true)
      const result = await promise

      expect(result.releasePhase).toEqual({attach: {...attachRelease, status: 'pending'}, status: 'timed_out'})
      expect(releaseInfo).toHaveBeenCalledOnce()
      expect(vi.getTimerCount()).toBe(0)
    })

    it('stops polling when attach keeps returning pending through the deadline', async () => {
      const attach = {id: 'attach-release', status: 'pending'}
      const releaseInfo = vi.fn().mockResolvedValue(attach)
      const ctx = buildCtx({
        formationList: vi.fn().mockResolvedValue([{type: 'release'}]),
        releaseInfo,
        releaseList: vi.fn().mockResolvedValue([
          {description: 'Attach DATABASE', id: 'attach-release'},
          {description: 'Detach DATABASE', id: 'detach-release'},
        ]),
      })
      let settled = false
      const promise = promoteDatabase(ctx, 'test-app', undefined, {
        force: true,
        releasePhasePollIntervalMs: 10,
        releasePhaseTimeoutMs: 25,
      }).then(result => {
        settled = true
        return result
      })

      await vi.advanceTimersByTimeAsync(0)
      expect(releaseInfo).toHaveBeenCalledOnce()
      await vi.advanceTimersByTimeAsync(24)
      expect(settled).toBe(false)
      expect(releaseInfo).toHaveBeenCalledTimes(3)

      await vi.advanceTimersByTimeAsync(1)
      const result = await promise

      expect(result.releasePhase).toEqual({attach, status: 'timed_out'})
      expect(releaseInfo).toHaveBeenCalledTimes(3)
      expect(vi.getTimerCount()).toBe(0)
    })

    it('times out and aborts a deferred attach lookup; late success does not change the result', async () => {
      let resolveAttach!: (release: {id: string; status: string}) => void
      const deferredAttach = new Promise<{id: string; status: string}>(resolve => {
        resolveAttach = resolve
      })
      const releaseInfo = vi.fn().mockReturnValue(deferredAttach)
      const ctx = buildCtx({
        formationList: vi.fn().mockResolvedValue([{type: 'release'}]),
        releaseInfo,
        releaseList: vi.fn().mockResolvedValue([
          {description: 'Attach DATABASE', id: 'attach-release'},
          {description: 'Detach DATABASE', id: 'detach-release'},
        ]),
      })
      const requestSignals = capturePlatformRequestSignals(ctx)
      let settled = false
      const promise = promoteDatabase(ctx, 'test-app', undefined, {
        force: true,
        releasePhaseTimeoutMs: 20,
      }).then(result => {
        settled = true
        return result
      })

      await vi.advanceTimersByTimeAsync(0)
      expect(releaseInfo).toHaveBeenCalledOnce()
      await vi.advanceTimersByTimeAsync(19)
      expect(settled).toBe(false)

      await vi.advanceTimersByTimeAsync(1)
      const result = await promise
      expect(settled).toBe(true)
      expect(requestSignals.at(-1)?.aborted).toBe(true)
      expect(result.releasePhase).toEqual({
        attach: {description: 'Attach DATABASE', id: 'attach-release', status: 'pending'},
        status: 'timed_out',
      })

      resolveAttach({id: 'attach-release', status: 'succeeded'})
      await Promise.resolve()
      expect(result.releasePhase).toEqual({
        attach: {description: 'Attach DATABASE', id: 'attach-release', status: 'pending'},
        status: 'timed_out',
      })
      expect(releaseInfo).toHaveBeenCalledOnce()
      expect(vi.getTimerCount()).toBe(0)
    })

    it('bounds a deferred detach lookup by the deadline and ignores late success', async () => {
      let resolveDetach!: (release: {id: string; status: string}) => void
      const deferredDetach = new Promise<{id: string; status: string}>(resolve => {
        resolveDetach = resolve
      })
      const attach = {id: 'attach-release', status: 'succeeded'}
      const detach = {id: 'detach-release', status: 'succeeded'}
      const releaseInfo = vi.fn()
        .mockResolvedValueOnce(attach)
        .mockReturnValueOnce(deferredDetach)
      const ctx = buildCtx({
        formationList: vi.fn().mockResolvedValue([{type: 'release'}]),
        releaseInfo,
        releaseList: vi.fn().mockResolvedValue([
          {description: 'Attach DATABASE', id: 'attach-release'},
          {description: 'Detach DATABASE', id: 'detach-release'},
        ]),
      })
      const requestSignals = capturePlatformRequestSignals(ctx)
      let settled = false
      const promise = promoteDatabase(ctx, 'test-app', undefined, {
        force: true,
        releasePhaseTimeoutMs: 20,
      }).then(result => {
        settled = true
        return result
      })

      await vi.advanceTimersByTimeAsync(0)
      expect(releaseInfo).toHaveBeenCalledTimes(2)
      await vi.advanceTimersByTimeAsync(19)
      expect(settled).toBe(false)

      await vi.advanceTimersByTimeAsync(1)
      const result = await promise

      expect(settled).toBe(true)
      expect(requestSignals.at(-1)?.aborted).toBe(true)
      expect(result.releasePhase).toEqual({attach, status: 'succeeded'})
      expect(result.releasePhase).not.toHaveProperty('detach')

      resolveDetach(detach)
      await Promise.resolve()
      expect(result.releasePhase).toEqual({attach, status: 'succeeded'})
      expect(releaseInfo).toHaveBeenCalledTimes(2)
      expect(vi.getTimerCount()).toBe(0)
    })

    it('aborts while waiting between release polls', async () => {
      const releaseInfo = vi.fn().mockResolvedValue({id: 'attach-release', status: 'pending'})
      const ctx = buildCtx({
        formationList: vi.fn().mockResolvedValue([{type: 'release'}]),
        releaseInfo,
        releaseList: vi.fn().mockResolvedValue([
          {description: 'Attach DATABASE', id: 'attach-release'},
          {description: 'Detach DATABASE', id: 'detach-release'},
        ]),
      })
      const controller = new AbortController()
      const reason = new Error('release polling cancelled')
      const promise = promoteDatabase(ctx, 'test-app', undefined, {
        force: true,
        releasePhasePollIntervalMs: 100,
        signal: controller.signal,
      })

      const expectation = expect(promise).rejects.toMatchObject({
        cause: reason,
        result: {mutationStatus: {attachment: {attempted: true, status: 'created'}}},
      })
      await vi.advanceTimersByTimeAsync(0)
      expect(releaseInfo).toHaveBeenCalledExactlyOnceWith('test-app', 'attach-release')
      await vi.advanceTimersByTimeAsync(25)
      expect(releaseInfo).toHaveBeenCalledOnce()
      expect(vi.getTimerCount()).toBeGreaterThan(0)

      controller.abort(reason)
      await expectation

      expect(releaseInfo).toHaveBeenCalledOnce()
      expect(vi.getTimerCount()).toBe(0)
    })

    it('does not poll again after 1ms when the poll interval exceeds the Node timer limit', async () => {
      const releaseInfo = vi.fn().mockResolvedValue({id: 'attach-release', status: 'pending'})
      const ctx = buildCtx({
        formationList: vi.fn().mockResolvedValue([{type: 'release'}]),
        releaseInfo,
        releaseList: vi.fn().mockResolvedValue([
          {description: 'Attach DATABASE', id: 'attach-release'},
          {description: 'Detach DATABASE', id: 'detach-release'},
        ]),
      })
      const fakeSetTimeout = globalThis.setTimeout
      vi.spyOn(globalThis, 'setTimeout').mockImplementation((callback, delay, ...args) => (
        fakeSetTimeout(callback, delay !== undefined && delay > 2_147_483_647 ? 1 : delay, ...args)
      ))
      const controller = new AbortController()
      const reason = new Error('release polling cancelled')
      const promise = promoteDatabase(ctx, 'test-app', undefined, {
        force: true,
        releasePhasePollIntervalMs: 2_147_483_648,
        releasePhaseTimeoutMs: 3_000_000_000,
        signal: controller.signal,
      })
      const expectation = expect(promise).rejects.toMatchObject({
        cause: reason,
        result: {mutationStatus: {attachment: {attempted: true, status: 'created'}}},
      })

      try {
        await vi.advanceTimersByTimeAsync(0)
        expect(releaseInfo).toHaveBeenCalledOnce()
        await vi.advanceTimersByTimeAsync(1)
        expect(releaseInfo).toHaveBeenCalledOnce()
        await vi.advanceTimersByTimeAsync(2_147_483_646)
        expect(releaseInfo).toHaveBeenCalledOnce()
        await vi.advanceTimersByTimeAsync(1)
        expect(releaseInfo).toHaveBeenCalledTimes(2)
      } finally {
        controller.abort(reason)
      }

      await expectation

      expect(releaseInfo).toHaveBeenCalledTimes(2)
      expect(vi.getTimerCount()).toBe(0)
    })

    it.each(['operation', 'caller'] as const)(
      'aborts a deferred release request when the %s signal is cancelled',
      async abortSource => {
        let resolveRelease!: (release: {id: string; status: string}) => void
        const deferredRelease = new Promise<{id: string; status: string}>(resolve => {
          resolveRelease = resolve
        })
        const releaseInfo = vi.fn().mockReturnValue(deferredRelease)
        const ctx = buildCtx({
          formationList: vi.fn().mockResolvedValue([{type: 'release'}]),
          releaseInfo,
          releaseList: vi.fn().mockResolvedValue([
            {description: 'Attach DATABASE', id: 'attach-release'},
            {description: 'Detach DATABASE', id: 'detach-release'},
          ]),
        })
        const operationController = new AbortController()
        const callerController = new AbortController()
        const reason = new Error(`${abortSource} release polling cancelled`)
        ctx.operationSignal = operationController.signal
        const requestSignals = capturePlatformRequestSignals(ctx)
        const promise = promoteDatabase(ctx, 'test-app', undefined, {
          force: true,
          releasePhaseTimeoutMs: 10_000,
          signal: callerController.signal,
        })
        const expectation = expect(promise).rejects.toMatchObject({
          cause: reason,
          result: {mutationStatus: {attachment: {attempted: true, status: 'created'}}},
        })
        const abortingController = abortSource === 'operation' ? operationController : callerController
        const otherController = abortSource === 'operation' ? callerController : operationController
        try {
          await vi.advanceTimersByTimeAsync(0)
          expect(releaseInfo).toHaveBeenCalledOnce()
          const requestSignal = requestSignals.at(-1)
          expect(requestSignal).toBeDefined()
          expect(requestSignal).not.toBe(operationController.signal)
          expect(requestSignal).not.toBe(callerController.signal)
          expect(requestSignal?.aborted).toBe(false)

          abortingController.abort(reason)
          await expectation

          expect(requestSignal?.aborted).toBe(true)
          expect(otherController.signal.aborted).toBe(false)
          expect(reason).toHaveProperty('promotionResult.attachment')
          expect(releaseInfo).toHaveBeenCalledOnce()
          expect(vi.getTimerCount()).toBe(0)

          resolveRelease({id: 'attach-release', status: 'succeeded'})
          await Promise.resolve()
          expect(releaseInfo).toHaveBeenCalledOnce()
        } finally {
          if (!abortingController.signal.aborted) {
            abortingController.abort(reason)
            await expectation
          }
        }
      },
    )
  })

  it('fails release-phase checks when required attach/detach releases are missing', async () => {
    const ctx = buildCtx({
      attachmentsByApp: vi.fn().mockResolvedValue([]),
      formationList: vi.fn().mockResolvedValue([{type: 'release'}]),
      releaseList: vi.fn().mockResolvedValue([]),
    })

    const error = await promoteDatabase(ctx, 'test-app', undefined, {force: true}).catch(error_ => error_)

    expect(error).toBeInstanceOf(DatabasePromotionError)
    expect(error.cause).toBeInstanceOf(DatabaseReleasePhaseError)
    expect(error.result.attachment).toEqual({name: 'DATABASE'})
    expect(error.result.mutationStatus).toEqual({
      attachment: {attempted: true, status: 'created'},
      backupAttachment: {attempted: false, status: 'not_attempted'},
      poolerAttachment: {attempted: false, status: 'not_attempted'},
    })
    expect(error.result.releasePhase).toEqual({status: 'unknown'})
  })

  it('includes the created backup alias when its callback throws', async () => {
    const current = {
      ...resolvedAttachment,
      addon: {...resolvedAttachment.addon, id: 'old-id', name: 'old-postgres'},
      name: 'DATABASE',
    }
    const backup = {...current, id: 'backup-id', name: 'RED'}
    const failure = new Error('backup callback failed')
    const attachmentCreate = vi.fn().mockResolvedValue(backup)
    const onBackupAttachment = vi.fn(() => {
      throw failure
    })
    const error = await promoteDatabase(buildCtx({
      attachmentCreate,
      attachmentsByApp: vi.fn().mockResolvedValue([current]),
    }), 'test-app', undefined, {force: true, onBackupAttachment}).catch(error_ => error_)

    expect(error).toBeInstanceOf(DatabasePromotionError)
    expect(error.cause).toBe(failure)
    expect(error.result.backupAttachment).toEqual(backup)
    expect(error.result.attachment).toBeUndefined()
    expect(error.result.mutationStatus).toEqual({
      attachment: {attempted: false, status: 'not_attempted'},
      backupAttachment: {attempted: true, status: 'created'},
      poolerAttachment: {attempted: false, status: 'not_attempted'},
    })
    expect(attachmentCreate).toHaveBeenCalledOnce()
  })

  it('marks backup attachment outcome unknown when create rejects and skips later mutations', async () => {
    const current = {
      ...resolvedAttachment,
      addon: {...resolvedAttachment.addon, id: 'old-id', name: 'old-postgres'},
      name: 'DATABASE',
    }
    const pooler = {...current, name: 'DATABASE_CONNECTION_POOL', namespace: 'connection-pooling:default'}
    const failure = new Error('connection lost while creating backup alias')
    const attachmentCreate = vi.fn().mockRejectedValue(failure)
    const onBackupAttachment = vi.fn()
    const error = await promoteDatabase(buildCtx({
      attachmentCreate,
      attachmentsByApp: vi.fn().mockResolvedValue([current, pooler]),
    }), 'test-app', undefined, {force: true, onBackupAttachment}).catch(error_ => error_)

    expect(error).toBeInstanceOf(DatabasePromotionError)
    expect(error.cause).toBe(failure)
    expect(error.result.backupAttachment).toBeUndefined()
    expect(error.result.attachment).toBeUndefined()
    expect(error.result.poolerAttachment).toBeUndefined()
    expect(error.result.mutationStatus).toEqual({
      attachment: {attempted: false, status: 'not_attempted'},
      backupAttachment: {attempted: true, status: 'unknown'},
      poolerAttachment: {attempted: false, status: 'not_attempted'},
    })
    expect(attachmentCreate).toHaveBeenCalledExactlyOnceWith({
      addon: current.addon.name,
      app: 'test-app',
      confirm: 'test-app',
      namespace: current.namespace,
    })
    expect(onBackupAttachment).not.toHaveBeenCalled()
  })

  it('marks promoted attachment outcome unknown when create rejects after remote acceptance', async () => {
    const remoteAttachment = {...resolvedAttachment, id: 'remote-promoted-id'}
    const failure = new Error('connection lost after create')
    let remotelyAccepted: typeof remoteAttachment | undefined
    const attachmentCreate = vi.fn(async () => {
      remotelyAccepted = remoteAttachment
      throw failure
    })
    const error = await promoteDatabase(buildCtx({attachmentCreate}), 'test-app', undefined, {force: true})
      .catch(error_ => error_)

    expect(remotelyAccepted).toEqual(remoteAttachment)
    expect(error).toBeInstanceOf(DatabasePromotionError)
    expect(error.cause).toBe(failure)
    expect(error.result.attachment).toBeUndefined()
    expect(error.result.mutationStatus.attachment).toEqual({attempted: true, status: 'unknown'})
    expect(error.result.mutationStatus.backupAttachment).toEqual({attempted: false, status: 'not_attempted'})
    expect(error.result.mutationStatus.poolerAttachment).toEqual({attempted: false, status: 'not_attempted'})
  })

  it('returns a partial promotion result when database info fails after promotion', async () => {
    const promotionAttachment = {...resolvedAttachment, id: 'promoted-id'}
    const failure = new Error('database info unavailable')
    const attachmentCreate = vi.fn().mockResolvedValue(promotionAttachment)
    const error = await promoteDatabase(buildCtx({
      attachmentCreate,
      databaseInfo: vi.fn().mockRejectedValue(failure),
    }), 'test-app', undefined, {force: true}).catch(error_ => error_)

    expect(error).toBeInstanceOf(DatabasePromotionError)
    expect(error.cause).toBe(failure)
    expect(error.result).toEqual({
      addon: resolvedAttachment.addon,
      attachment: promotionAttachment,
      mutationStatus: {
        attachment: {attempted: true, status: 'created'},
        backupAttachment: {attempted: false, status: 'not_attempted'},
        poolerAttachment: {attempted: false, status: 'not_attempted'},
      },
    })
  })

  it.each([
    ['formation lookup', {formationList: vi.fn().mockRejectedValue(new Error('formation failed'))}],
    ['release lookup', {
      formationList: vi.fn().mockResolvedValue([{type: 'release'}]),
      releaseList: vi.fn().mockRejectedValue(new Error('release list failed')),
    }],
    ['release status lookup', {
      formationList: vi.fn().mockResolvedValue([{type: 'release'}]),
      releaseInfo: vi.fn().mockRejectedValue(new Error('release status failed')),
      releaseList: vi.fn().mockResolvedValue([
        {description: 'Attach DATABASE', id: 'attach-release'},
        {description: 'Detach DATABASE', id: 'detach-release'},
      ]),
    }],
  ])('preserves promotion outcome when %s fails', async (step, options) => {
    const promotionAttachment = {...resolvedAttachment, id: 'promoted-id'}
    const error = await promoteDatabase(buildCtx({
      attachmentCreate: vi.fn().mockResolvedValue(promotionAttachment),
      ...options,
    }), 'test-app', undefined, {force: true}).catch(error_ => error_)

    expect(error).toBeInstanceOf(DatabasePromotionError)
    expect(error.result.attachment).toEqual(promotionAttachment)
    expect(error.result.database).toEqual({})
    expect(error.result.mutationStatus.attachment).toEqual({attempted: true, status: 'created'})
    expect(error.result.releasePhase).toEqual(step === 'release status lookup'
      ? {attach: {description: 'Attach DATABASE', id: 'attach-release', status: 'pending'}, status: 'unknown'}
      : {status: 'unknown'})
  })

  it('preserves promotion outcome when optional pooler attachment fails', async () => {
    const current = {
      ...resolvedAttachment,
      addon: {...resolvedAttachment.addon, id: 'old-id', name: 'old-postgres'},
      name: 'DATABASE',
    }
    const pooler = {...current, name: 'DATABASE_CONNECTION_POOL', namespace: 'connection-pooling:default'}
    const promotionAttachment = {...resolvedAttachment, id: 'promoted-id'}
    const failure = new Error('pooler attach failed')
    const attachmentCreate = vi.fn()
      .mockResolvedValueOnce(promotionAttachment)
      .mockRejectedValueOnce(failure)
    const error = await promoteDatabase(buildCtx({
      attachmentCreate,
      attachmentsByApp: vi.fn().mockResolvedValue([current, {...current, name: 'RED'}, pooler]),
    }), 'test-app', undefined, {force: true}).catch(error_ => error_)

    expect(error).toBeInstanceOf(DatabasePromotionError)
    expect(error.cause).toBe(failure)
    expect(error.result.attachment).toEqual(promotionAttachment)
    expect(error.result.database).toBeUndefined()
    expect(error.result.mutationStatus).toEqual({
      attachment: {attempted: true, status: 'created'},
      backupAttachment: {attempted: false, status: 'not_attempted'},
      poolerAttachment: {attempted: true, status: 'unknown'},
    })
    expect(error.result.releasePhase).toBeUndefined()
  })

  it.each([
    ['zero release-phase timeout', {releasePhaseTimeoutMs: 0}],
    ['negative release-phase timeout', {releasePhaseTimeoutMs: -1}],
    ['non-finite release-phase timeout', {releasePhaseTimeoutMs: Number.NaN}],
    ['zero poll interval', {releasePhasePollIntervalMs: 0}],
    ['negative poll interval', {releasePhasePollIntervalMs: -1}],
    ['non-finite poll interval', {releasePhasePollIntervalMs: Number.POSITIVE_INFINITY}],
  ])('rejects invalid %s before any promotion work', async (_setting, options) => {
    const attachmentCreate = vi.fn()
    const resolutionByAttachment = vi.fn()
    await expect(promoteDatabase(buildCtx({attachmentCreate, resolutionByAttachment}), 'test-app', undefined, options))
      .rejects.toBeInstanceOf(RangeError)
    expect(resolutionByAttachment).not.toHaveBeenCalled()
    expect(attachmentCreate).not.toHaveBeenCalled()
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
      origin: {name: 'LEADER_URL', type: 'config_var'},
    }))
    expect(databaseUnfollow).toHaveBeenCalledExactlyOnceWith('database-id')
    expect(result.origin).toEqual({name: 'LEADER_URL', type: 'config_var'})
    expect(result.result).toEqual({message: 'unfollowed'})
  })

  it('returns structured URL origin details including PGPORT and the default port', async () => {
    const ctx = buildCtx({
      configVars: vi.fn().mockResolvedValue({PGPORT: '6432'}),
      databaseInfo: vi.fn().mockResolvedValue({following: 'postgres://db.example.com/mydb'}),
    })

    const result = await unfollowDatabase(ctx, 'test-app')

    expect(result.origin).toEqual({
      defaultPort: '5432',
      hostname: 'db.example.com',
      pathname: '/mydb',
      pgPort: '6432',
      port: '5432',
      protocol: 'postgres:',
      type: 'url',
    })
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

  it.each(['operation', 'caller'] as const)(
    'aborts an in-flight unfollow request when the %s signal is cancelled',
    async abortSource => {
      const operationController = new AbortController()
      const callerController = new AbortController()
      const requestSignals: AbortSignal[] = []
      let markRequestStarted!: () => void
      const requestStarted = new Promise<void>(resolve => {
        markRequestStarted = resolve
      })
      const databaseUnfollow = vi.fn((_id: string) => new Promise<never>((_resolve, reject) => {
        markRequestStarted()
        const requestSignal = requestSignals.at(-1)
        if (!requestSignal) {
          reject(new Error('unfollow request signal was not bound'))
          return
        }

        requestSignal.addEventListener('abort', () => reject(requestSignal.reason), {once: true})
      }))
      const ctx = buildCtx({
        configVars: vi.fn().mockResolvedValue({}),
        databaseInfo: vi.fn().mockResolvedValue({following: 'postgres://host:5432/db'}),
        databaseUnfollow,
        operationSignal: operationController.signal,
      })
      const data = ctx.data as unknown as {
        database: {unfollow: typeof databaseUnfollow}
        withOptions: ReturnType<typeof vi.fn>
      }
      data.withOptions.mockImplementation((options: {signal?: AbortSignal}) => {
        if (options.signal) requestSignals.push(options.signal)

        return ctx.data
      })
      const reason = new Error(`${abortSource} cancellation`)

      const promise = unfollowDatabase(ctx, 'test-app', undefined, {
        signal: callerController.signal,
      })
      const expectation = expect(promise).rejects.toBe(reason)
      await requestStarted
      const effectiveSignal = requestSignals.at(-1)
      expect(effectiveSignal).toBeDefined()
      expect(effectiveSignal).not.toBe(operationController.signal)
      expect(effectiveSignal).not.toBe(callerController.signal)

      const abortingController = abortSource === 'operation' ? operationController : callerController
      const otherController = abortSource === 'operation' ? callerController : operationController
      abortingController.abort(reason)
      await expectation

      expect(effectiveSignal?.aborted).toBe(true)
      expect(otherController.signal.aborted).toBe(false)
      expect(databaseUnfollow).toHaveBeenCalledExactlyOnceWith('database-id')
    },
  )

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
    expect(Object.keys(methods)).toEqual(['promoteForApp', 'resetForApp', 'unfollowForApp'])
    expect(methods.promoteForApp).toBeTypeOf('function')

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

  it('sends an empty reset body when extensions is an empty string', async () => {
    const requests: Array<{body?: unknown; method: string; path: string}> = []
    vi.spyOn(HerokuApiClient.prototype, 'post').mockImplementation(async (path, body) => {
      requests.push({body, method: 'POST', path})
      return mockApiResponse([resolvedAttachment])
    })
    vi.spyOn(HerokuApiClient.prototype, 'put').mockImplementation(async (path, body) => {
      requests.push({body, method: 'PUT', path})
      return mockApiResponse({message: 'reset'})
    })
    const sdk = new HerokuSDK({extensions: [databaseCommandExtensions]})

    await sdk.data.database.resetForApp('test-app', 'DATABASE_URL', {extensions: ''})

    expect(requests).toEqual([
      {
        body: {addon_attachment: 'DATABASE_URL', app: 'test-app'},
        method: 'POST',
        path: '/actions/addon-attachments/resolve',
      },
      {body: {}, method: 'PUT', path: '/client/v11/databases/database-id/reset'},
    ])
  })

  it('sends an empty extensions array when extensions is an empty array', async () => {
    const requests: Array<{body?: unknown; method: string; path: string}> = []
    vi.spyOn(HerokuApiClient.prototype, 'post').mockImplementation(async (path, body) => {
      requests.push({body, method: 'POST', path})
      return mockApiResponse([resolvedAttachment])
    })
    vi.spyOn(HerokuApiClient.prototype, 'put').mockImplementation(async (path, body) => {
      requests.push({body, method: 'PUT', path})
      return mockApiResponse({message: 'reset'})
    })
    const sdk = new HerokuSDK({extensions: [databaseCommandExtensions]})

    await sdk.data.database.resetForApp('test-app', 'DATABASE_URL', {extensions: []})

    expect(requests).toEqual([
      {
        body: {addon_attachment: 'DATABASE_URL', app: 'test-app'},
        method: 'POST',
        path: '/actions/addon-attachments/resolve',
      },
      {body: {extensions: []}, method: 'PUT', path: '/client/v11/databases/database-id/reset'},
    ])
  })
})
