import {NotFoundError} from '@heroku/heroku-fetch'
import {
  afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest'

import type {ResourceCtx} from '../../core/extend-resource.js'

import {
  LegacyDatabaseWaitError, legacyDatabaseWaitExtensions, waitForLegacyDatabaseReady,
} from './database-wait-for-ready.js'

type Fn = ReturnType<typeof vi.fn>

function buildNotFound(): NotFoundError {
  const response = new Response(JSON.stringify({id: 'not_found', resource: 'database'}), {
    headers: {'content-type': 'application/json'},
    status: 404,
  })
  return new NotFoundError(response, {id: 'not_found', resource: 'database'})
}

function buildAddon(id: string, name = `postgres-${id}`) {
  return {
    app: {id: 'app-id', name: 'my-app'},
    id,
    name,
    plan: {name: 'heroku-postgresql:standard-0'},
  }
}

function buildCtx(opts: {
  listByApp?: Fn
  operationSignal?: AbortSignal
  resolution?: Fn
  waitStatus?: Fn
  withDataOptions?: (options?: {signal?: AbortSignal}) => void
  withPlatformOptions?: (options?: {signal?: AbortSignal}) => void
} = {}): Pick<ResourceCtx, 'data' | 'operationSignal' | 'platform'> {
  const data = {
    database: {waitStatus: opts.waitStatus ?? vi.fn().mockResolvedValue({message: 'ready', 'waiting?': false})},
    withOptions(options?: {signal?: AbortSignal}) {
      opts.withDataOptions?.(options)
      return data
    },
  }
  const platform = {
    addOnAttachment: {
      listByApp: opts.listByApp ?? vi.fn().mockResolvedValue([]),
      resolution: opts.resolution ?? vi.fn().mockResolvedValue([{addon: buildAddon('one'), app: {id: 'app-id', name: 'my-app'}}]),
    },
    withHeaders() {
      return platform
    },
    withOptions(options?: {signal?: AbortSignal}) {
      opts.withPlatformOptions?.(options)
      return platform
    },
  }

  return {data: data as never, operationSignal: opts.operationSignal, platform: platform as never}
}

describe('legacyDatabaseWaitExtensions', () => {
  it('declares data.database and exposes waitForReadyForApp', () => {
    expect(legacyDatabaseWaitExtensions.service).toBe('data')
    expect(legacyDatabaseWaitExtensions.resource).toBe('database')
    expect(typeof legacyDatabaseWaitExtensions.factory({data: {} as never, platform: {} as never}).waitForReadyForApp).toBe('function')
  })
})

describe('waitForLegacyDatabaseReady', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  it('resolves the supplied identity only and returns the addon with terminal status', async () => {
    const resolution = vi.fn().mockResolvedValue([{addon: buildAddon('target'), app: {id: 'app-id', name: 'my-app'}}])
    const listByApp = vi.fn()
    const waitStatus = vi.fn().mockResolvedValue({message: 'available', 'waiting?': false})
    const ctx = buildCtx({listByApp, resolution, waitStatus})

    const result = await waitForLegacyDatabaseReady(ctx, 'my-app', 'DATABASE_URL')

    expect(resolution).toHaveBeenCalledOnce()
    expect(listByApp).not.toHaveBeenCalled()
    expect(waitStatus).toHaveBeenCalledExactlyOnceWith('target')
    expect(result.databases).toEqual([{addon: buildAddon('target'), status: {message: 'available', 'waiting?': false}}])
  })

  it('waits for every visible legacy database sequentially in list order', async () => {
    const listByApp = vi.fn().mockResolvedValue([
      {addon: buildAddon('first'), app: {id: 'app-id', name: 'my-app'}, name: 'DATABASE_URL'},
      {addon: buildAddon('second'), app: {id: 'app-id', name: 'my-app'}, name: 'HEROKU_POSTGRESQL_CYAN'},
    ])
    const calls: string[] = []
    const waitStatus = vi.fn(async (id: string) => {
      calls.push(id)
      return {message: 'ready', 'waiting?': false}
    })
    const ctx = buildCtx({listByApp, waitStatus})

    const result = await waitForLegacyDatabaseReady(ctx, 'my-app')

    expect(calls).toEqual(['first', 'second'])
    expect(result.databases.map(({addon}) => addon.id)).toEqual(['first', 'second'])
    expect(listByApp).toHaveBeenCalledExactlyOnceWith('my-app')
  })

  it('polls waiting statuses and returns the final status', async () => {
    const waitStatus = vi.fn()
      .mockResolvedValueOnce({message: 'pending', 'waiting?': true})
      .mockResolvedValueOnce({message: 'available', 'waiting?': false})
    const onPoll = vi.fn()
    const ctx = buildCtx({waitStatus})

    const promise = waitForLegacyDatabaseReady(ctx, 'my-app', 'DATABASE_URL', {onPoll, waitIntervalMs: 125})

    await vi.advanceTimersByTimeAsync(0)
    expect(waitStatus).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(124)
    expect(waitStatus).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)

    const result = await promise
    expect(waitStatus).toHaveBeenCalledTimes(2)
    expect(onPoll).toHaveBeenNthCalledWith(1, {addon: buildAddon('one'), status: {message: 'pending', 'waiting?': true}})
    expect(result.databases[0].status).toEqual({message: 'available', 'waiting?': false})
  })

  it('throws a structured error when status has error?', async () => {
    const status = {'error?': true, message: 'database failed to provision', 'waiting?': false}
    const onPoll = vi.fn()
    const ctx = buildCtx({waitStatus: vi.fn().mockResolvedValue(status)})

    const error = await waitForLegacyDatabaseReady(ctx, 'my-app', 'DATABASE_URL', {onPoll})
      .catch((error_: unknown) => error_)

    expect(error).toBeInstanceOf(LegacyDatabaseWaitError)
    expect((error as LegacyDatabaseWaitError).addon.id).toBe('one')
    expect((error as LegacyDatabaseWaitError).status).toEqual(status)
    expect((error as Error).message).toBe(status.message)
    expect(onPoll).toHaveBeenCalledExactlyOnceWith({addon: buildAddon('one'), status})
  })

  it('tolerates exactly 20 wait-status 404s, then propagates the next one', async () => {
    const waitStatus = vi.fn().mockRejectedValue(buildNotFound())
    const onPoll = vi.fn()
    const ctx = buildCtx({waitStatus})

    const promise = waitForLegacyDatabaseReady(ctx, 'my-app', 'DATABASE_URL', {onPoll, waitIntervalMs: 1})
    const expectation = expect(promise).rejects.toBeInstanceOf(NotFoundError)
    await vi.advanceTimersByTimeAsync(25)
    await expectation

    expect(waitStatus).toHaveBeenCalledTimes(21)
    expect(onPoll).toHaveBeenCalledTimes(20)
    expect(onPoll).toHaveBeenNthCalledWith(1, {
      addon: buildAddon('one'),
      status: {message: 'Waiting to provision...', 'waiting?': true},
    })
  })

  it('has no default timeout', async () => {
    const waitStatus = vi.fn()
      .mockResolvedValueOnce({message: 'still waiting', 'waiting?': true})
      .mockResolvedValueOnce({message: 'ready', 'waiting?': false})
    const ctx = buildCtx({waitStatus})

    const promise = waitForLegacyDatabaseReady(ctx, 'my-app', 'DATABASE_URL', {waitIntervalMs: 60 * 60 * 1000})
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(60 * 60 * 1000)

    await expect(promise).resolves.toMatchObject({databases: [{status: {'waiting?': false}}]})
    expect(waitStatus).toHaveBeenCalledTimes(2)
  })

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])('uses the default interval for invalid interval %s', async waitIntervalMs => {
    const waitStatus = vi.fn()
      .mockResolvedValueOnce({message: 'pending', 'waiting?': true})
      .mockResolvedValueOnce({message: 'ready', 'waiting?': false})
    const ctx = buildCtx({waitStatus})

    const promise = waitForLegacyDatabaseReady(ctx, 'my-app', 'DATABASE_URL', {waitIntervalMs})
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(4999)
    expect(waitStatus).toHaveBeenCalledOnce()
    await vi.advanceTimersByTimeAsync(1)

    await expect(promise).resolves.toMatchObject({databases: [{status: {'waiting?': false}}]})
    expect(waitStatus).toHaveBeenCalledTimes(2)
  })

  it('aborts the poll delay', async () => {
    const waitStatus = vi.fn().mockResolvedValue({message: 'pending', 'waiting?': true})
    const ctx = buildCtx({waitStatus})
    const controller = new AbortController()

    const promise = waitForLegacyDatabaseReady(ctx, 'my-app', 'DATABASE_URL', {
      signal: controller.signal, waitIntervalMs: 5000,
    })
    const expectation = expect(promise).rejects.toThrow(/aborted/i)
    await vi.advanceTimersByTimeAsync(0)
    controller.abort()
    await vi.advanceTimersByTimeAsync(0)
    await expectation

    expect(waitStatus).toHaveBeenCalledOnce()
  })

  it('combines operation and per-call signals while waiting between polls', async () => {
    const operationController = new AbortController()
    const callerController = new AbortController()
    const waitStatus = vi.fn().mockResolvedValue({message: 'pending', 'waiting?': true})
    const ctx = buildCtx({operationSignal: operationController.signal, waitStatus})

    const promise = waitForLegacyDatabaseReady(ctx, 'my-app', 'DATABASE_URL', {
      signal: callerController.signal, waitIntervalMs: 5000,
    })
    const expectation = expect(promise).rejects.toThrow(/aborted/i)
    await vi.advanceTimersByTimeAsync(0)
    operationController.abort()
    await vi.advanceTimersByTimeAsync(0)
    await expectation

    expect(waitStatus).toHaveBeenCalledOnce()
    expect(callerController.signal.aborted).toBe(false)
  })

  it('aborts the poll delay from the per-call signal without aborting the operation signal', async () => {
    const operationController = new AbortController()
    const callerController = new AbortController()
    const waitStatus = vi.fn().mockResolvedValue({message: 'pending', 'waiting?': true})
    const ctx = buildCtx({operationSignal: operationController.signal, waitStatus})

    const promise = waitForLegacyDatabaseReady(ctx, 'my-app', 'DATABASE_URL', {
      signal: callerController.signal, waitIntervalMs: 5000,
    })
    const expectation = expect(promise).rejects.toThrow(/aborted/i)
    await vi.advanceTimersByTimeAsync(0)
    callerController.abort()
    await vi.advanceTimersByTimeAsync(0)
    await expectation

    expect(waitStatus).toHaveBeenCalledOnce()
    expect(callerController.signal.aborted).toBe(true)
    expect(operationController.signal.aborted).toBe(false)
  })

  it('aborts an in-flight resolution from the per-call signal without aborting the operation signal', async () => {
    const operationController = new AbortController()
    const callerController = new AbortController()
    const abortReason = new Error('caller cancelled')
    let requestSignal: AbortSignal | undefined
    const resolution = vi.fn(() => new Promise<never>((_resolve, reject) => {
      requestSignal?.addEventListener('abort', () => reject(requestSignal?.reason ?? new Error('request aborted')), {once: true})
    }))
    const withPlatformOptions = vi.fn((options?: {signal?: AbortSignal}) => {
      requestSignal = options?.signal
    })
    const ctx = buildCtx({operationSignal: operationController.signal, resolution, withPlatformOptions})

    const promise = waitForLegacyDatabaseReady(ctx, 'my-app', 'DATABASE_URL', {signal: callerController.signal})
    const expectation = expect(promise).rejects.toBe(abortReason)

    expect(withPlatformOptions).toHaveBeenCalledExactlyOnceWith({signal: expect.any(AbortSignal)})
    expect(requestSignal).not.toBe(operationController.signal)
    expect(requestSignal).not.toBe(callerController.signal)
    expect(resolution).toHaveBeenCalledOnce()
    expect(requestSignal?.aborted).toBe(false)
    callerController.abort(abortReason)
    await expectation

    expect(resolution).toHaveBeenCalledOnce()
    expect(ctx.data.database.waitStatus).not.toHaveBeenCalled()
    expect(callerController.signal.aborted).toBe(true)
    expect(operationController.signal.aborted).toBe(false)
  })

  it('aborts an in-flight resolution from the operation signal without aborting the per-call signal', async () => {
    const operationController = new AbortController()
    const callerController = new AbortController()
    const abortReason = new Error('operation cancelled')
    let requestSignal: AbortSignal | undefined
    const resolution = vi.fn(() => new Promise<never>((_resolve, reject) => {
      requestSignal?.addEventListener('abort', () => reject(requestSignal?.reason ?? new Error('request aborted')), {once: true})
    }))
    const withPlatformOptions = vi.fn((options?: {signal?: AbortSignal}) => {
      requestSignal = options?.signal
    })
    const ctx = buildCtx({operationSignal: operationController.signal, resolution, withPlatformOptions})

    const promise = waitForLegacyDatabaseReady(ctx, 'my-app', 'DATABASE_URL', {signal: callerController.signal})
    const expectation = expect(promise).rejects.toBe(abortReason)

    expect(withPlatformOptions).toHaveBeenCalledExactlyOnceWith({signal: expect.any(AbortSignal)})
    expect(requestSignal).not.toBe(operationController.signal)
    expect(requestSignal).not.toBe(callerController.signal)
    expect(resolution).toHaveBeenCalledOnce()
    expect(requestSignal?.aborted).toBe(false)
    operationController.abort(abortReason)
    await expectation

    expect(resolution).toHaveBeenCalledOnce()
    expect(ctx.data.database.waitStatus).not.toHaveBeenCalled()
    expect(operationController.signal.aborted).toBe(true)
    expect(callerController.signal.aborted).toBe(false)
  })

  it('binds the signal to the data client so it aborts an in-flight request', async () => {
    const controller = new AbortController()
    let requestSignal: AbortSignal | undefined
    const waitStatus = vi.fn(() => new Promise<never>((_resolve, reject) => {
      requestSignal?.addEventListener('abort', () => reject(new Error('request aborted')), {once: true})
    }))
    const withDataOptions = vi.fn((options?: {signal?: AbortSignal}) => {
      requestSignal = options?.signal
    })
    const ctx = buildCtx({waitStatus, withDataOptions})

    const promise = waitForLegacyDatabaseReady(ctx, 'my-app', 'DATABASE_URL', {signal: controller.signal})
    const expectation = expect(promise).rejects.toThrow('request aborted')
    await vi.advanceTimersByTimeAsync(0)

    expect(withDataOptions).toHaveBeenCalledExactlyOnceWith({signal: controller.signal})
    expect(waitStatus).toHaveBeenCalledOnce()
    controller.abort()
    await expectation
  })

  it('combines operation and per-call signals for an in-flight request', async () => {
    const operationController = new AbortController()
    const callerController = new AbortController()
    let requestSignal: AbortSignal | undefined
    const waitStatus = vi.fn(() => new Promise<never>((_resolve, reject) => {
      requestSignal?.addEventListener('abort', () => reject(requestSignal?.reason ?? new Error('request aborted')), {once: true})
    }))
    const withDataOptions = vi.fn((options?: {signal?: AbortSignal}) => {
      requestSignal = options?.signal
    })
    const ctx = buildCtx({operationSignal: operationController.signal, waitStatus, withDataOptions})

    const promise = waitForLegacyDatabaseReady(ctx, 'my-app', 'DATABASE_URL', {signal: callerController.signal})
    const expectation = expect(promise).rejects.toThrow(/aborted/i)
    await vi.advanceTimersByTimeAsync(0)

    expect(requestSignal).toBeInstanceOf(AbortSignal)
    expect(requestSignal).not.toBe(operationController.signal)
    expect(requestSignal).not.toBe(callerController.signal)
    operationController.abort()
    await expectation

    expect(waitStatus).toHaveBeenCalledOnce()
    expect(callerController.signal.aborted).toBe(false)
  })

  it('aborts an in-flight request from the per-call signal without aborting the operation signal', async () => {
    const operationController = new AbortController()
    const callerController = new AbortController()
    let requestSignal: AbortSignal | undefined
    const waitStatus = vi.fn(() => new Promise<never>((_resolve, reject) => {
      requestSignal?.addEventListener('abort', () => reject(requestSignal?.reason ?? new Error('request aborted')), {once: true})
    }))
    const withDataOptions = vi.fn((options?: {signal?: AbortSignal}) => {
      requestSignal = options?.signal
    })
    const ctx = buildCtx({operationSignal: operationController.signal, waitStatus, withDataOptions})

    const promise = waitForLegacyDatabaseReady(ctx, 'my-app', 'DATABASE_URL', {signal: callerController.signal})
    const expectation = expect(promise).rejects.toThrow(/aborted/i)
    await vi.advanceTimersByTimeAsync(0)

    expect(requestSignal).toBeInstanceOf(AbortSignal)
    expect(requestSignal).not.toBe(operationController.signal)
    expect(requestSignal).not.toBe(callerController.signal)
    callerController.abort()
    await expectation

    expect(waitStatus).toHaveBeenCalledOnce()
    expect(operationController.signal.aborted).toBe(false)
  })
})
