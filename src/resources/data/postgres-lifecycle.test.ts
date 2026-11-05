/* eslint-disable camelcase */
import {HerokuApiError, NotFoundError} from '@heroku/heroku-fetch'
import {
  afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest'

import type {ResourceCtx} from '../../core/extend-resource.js'

import {AddonConfirmationRequiredError} from '../platform/add-on/errors.js'
import {getPostgresServiceName, NotAdvancedDatabaseError} from './internal/postgres-utils.js'
import {
  fork, postgresExtensions, provisionAdvanced, waitForReady,
} from './postgres.js'

type Fn = ReturnType<typeof vi.fn>

function buildNotFound(): NotFoundError {
  const response = new Response(JSON.stringify({id: 'not_found'}), {
    headers: {'content-type': 'application/json'},
    status: 404,
  })
  return new NotFoundError(response, {id: 'not_found', resource: 'postgres'})
}

function buildConfirmationRequired(): HerokuApiError {
  return new HerokuApiError('Please confirm by typing the app name.', 423, new Response(null, {status: 423}), {
    id: 'confirmation_required',
    message: 'Please confirm by typing the app name.',
  })
}

/**
 * An attachment-resolution match (for `resolvePgDatabase`, used by
 * `waitForReady`).
 */
function buildAttachmentMatch(opts: {addonId?: string; addonName?: string; planName: string}) {
  return [
    {
      addon: {
        app: {id: 'app-uuid', name: 'app-1'},
        id: opts.addonId ?? 'addon-1',
        name: opts.addonName ?? 'pg-addon',
        plan: {name: opts.planName},
      },
      app: {id: 'app-uuid', name: 'app-1'},
      id: 'attachment-1',
      name: 'DATABASE',
    },
  ]
}

/** An add-on-resolution match (for `resolveAddonInternal`, used by `fork`). */
function buildAddonMatch(opts: {id?: string; name?: string; planName: string}) {
  return [
    {
      addon_service: {name: getPostgresServiceName()},
      app: {id: 'app-uuid', name: 'app-1'},
      id: opts.id ?? 'source-addon',
      name: opts.name ?? 'postgres-source',
      plan: {name: opts.planName},
    },
  ]
}

function buildCtx(opts: {
  addonResolution?: Fn
  create?: Fn
  info?: Fn
  poolCreate?: Fn
  resolutionByAttachment?: Fn
  waitStatus?: Fn
} = {}): Pick<ResourceCtx, 'data' | 'platform'> {
  const data: Record<string, unknown> = {
    postgres: {
      info: opts.info ?? vi.fn(),
      waitStatus: opts.waitStatus ?? vi.fn().mockResolvedValue({message: 'ready', waiting: false}),
    },
    postgresPool: {create: opts.poolCreate ?? vi.fn().mockResolvedValue({expected_level: 'advanced-0', name: 'follower'})},
  }
  data.withOptions = vi.fn(() => data)

  return {
    data: data as never,
    platform: {
      addOn: {
        create: opts.create ?? vi.fn().mockResolvedValue({id: 'new-addon', name: 'postgres-new', state: 'available'}),
        resolution: opts.addonResolution ?? vi.fn(),
      },
      addOnAttachment: {
        resolution: opts.resolutionByAttachment ?? vi.fn(),
      },
      withHeaders() {
        return this
      },
      withOptions() {
        return this
      },
    } as never,
  }
}

describe('postgresExtensions factory', () => {
  it('exposes runUpgrade, waitForReady, provisionAdvanced and fork', () => {
    const methods = postgresExtensions.factory({data: {} as never, platform: {} as never})
    expect(typeof methods.runUpgrade).toBe('function')
    expect(typeof methods.waitForReady).toBe('function')
    expect(typeof methods.provisionAdvanced).toBe('function')
    expect(typeof methods.fork).toBe('function')
  })
})

describe('waitForReady', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  it('resolves the database, gates on Advanced tier, and returns once waiting is false', async () => {
    const resolutionByAttachment = vi.fn().mockResolvedValue(buildAttachmentMatch({addonId: 'addon-1', planName: 'heroku-postgresql:advanced-0'}))
    const waitStatus = vi.fn().mockResolvedValue({message: 'ready', waiting: false})
    const ctx = buildCtx({resolutionByAttachment, waitStatus})

    const {addon, result} = await waitForReady(ctx, 'app-1', 'DATABASE_URL')

    expect(waitStatus).toHaveBeenCalledExactlyOnceWith('addon-1')
    expect(addon.id).toBe('addon-1')
    expect(result).toEqual({message: 'ready', waiting: false})
  })

  it('fires onResolved with the resolved addon before the first poll', async () => {
    const calls: string[] = []
    const resolutionByAttachment = vi.fn().mockResolvedValue(buildAttachmentMatch({addonId: 'addon-1', planName: 'heroku-postgresql:advanced-0'}))
    const waitStatus = vi.fn(() => {
      calls.push('waitStatus')
      return Promise.resolve({message: 'ready', waiting: false})
    })
    const onResolved = vi.fn(addon => {
      calls.push('onResolved')
      expect(addon.id).toBe('addon-1')
    })
    const ctx = buildCtx({resolutionByAttachment, waitStatus})

    await waitForReady(ctx, 'app-1', 'DATABASE_URL', {onResolved})

    expect(onResolved).toHaveBeenCalledOnce()
    expect(calls).toEqual(['onResolved', 'waitStatus'])
  })

  it('throws NotAdvancedDatabaseError (carrying the addon) for a classic database, without firing onResolved or polling', async () => {
    const resolutionByAttachment = vi.fn().mockResolvedValue(buildAttachmentMatch({addonId: 'addon-1', planName: 'heroku-postgresql:standard-0'}))
    const waitStatus = vi.fn()
    const onResolved = vi.fn()
    const ctx = buildCtx({resolutionByAttachment, waitStatus})

    const error = await waitForReady(ctx, 'app-1', 'DATABASE_URL', {onResolved}).catch((error_: unknown) => error_)

    expect(error).toBeInstanceOf(NotAdvancedDatabaseError)
    expect((error as NotAdvancedDatabaseError).addon.id).toBe('addon-1')
    expect(onResolved).not.toHaveBeenCalled()
    expect(waitStatus).not.toHaveBeenCalled()
  })

  it('polls until waiting flips false, firing onPoll each time', async () => {
    const resolutionByAttachment = vi.fn().mockResolvedValue(buildAttachmentMatch({planName: 'heroku-postgresql:advanced-0'}))
    const waitStatus = vi.fn()
      .mockResolvedValueOnce({message: 'Provisioning', waiting: true})
      .mockResolvedValueOnce({message: 'ready', waiting: false})
    const onPoll = vi.fn()
    const ctx = buildCtx({resolutionByAttachment, waitStatus})

    const promise = waitForReady(ctx, 'app-1', 'DATABASE_URL', {onPoll, waitIntervalMs: 100})

    await vi.advanceTimersByTimeAsync(0)
    expect(waitStatus).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(100)

    const {result} = await promise
    expect(waitStatus).toHaveBeenCalledTimes(2)
    expect(result.waiting).toBe(false)
    expect(onPoll).toHaveBeenNthCalledWith(1, {message: 'Provisioning', waiting: true})
    expect(onPoll).toHaveBeenNthCalledWith(2, {message: 'ready', waiting: false})
  })

  it('tolerates 404s up to the budget (synthesizing a provisioning status) then rethrows', async () => {
    const resolutionByAttachment = vi.fn().mockResolvedValue(buildAttachmentMatch({planName: 'heroku-postgresql:advanced-0'}))
    const waitStatus = vi.fn().mockRejectedValue(buildNotFound())
    const onPoll = vi.fn()
    const ctx = buildCtx({resolutionByAttachment, waitStatus})

    const promise = waitForReady(ctx, 'app-1', 'DATABASE_URL', {notFoundRetries: 2, onPoll, waitIntervalMs: 10})
    const expectation = expect(promise).rejects.toBeInstanceOf(NotFoundError)
    await vi.advanceTimersByTimeAsync(100)
    await expectation

    // 2 tolerated 404s (synthetic status) + the 3rd that rethrows.
    expect(waitStatus).toHaveBeenCalledTimes(3)
    expect(onPoll).toHaveBeenCalledTimes(2)
    expect(onPoll).toHaveBeenNthCalledWith(1, {message: 'Waiting to provision...', waiting: true})
  })

  it('propagates non-404 errors immediately', async () => {
    const resolutionByAttachment = vi.fn().mockResolvedValue(buildAttachmentMatch({planName: 'heroku-postgresql:advanced-0'}))
    const waitStatus = vi.fn().mockRejectedValue(new Error('boom'))
    const ctx = buildCtx({resolutionByAttachment, waitStatus})

    await expect(waitForReady(ctx, 'app-1', 'DATABASE_URL', {waitIntervalMs: 10})).rejects.toThrow('boom')
  })

  it('throws when timeoutMs elapses before ready', async () => {
    const resolutionByAttachment = vi.fn().mockResolvedValue(buildAttachmentMatch({planName: 'heroku-postgresql:advanced-0'}))
    const waitStatus = vi.fn().mockResolvedValue({message: 'still waiting', waiting: true})
    const ctx = buildCtx({resolutionByAttachment, waitStatus})

    const promise = waitForReady(ctx, 'app-1', 'DATABASE_URL', {timeoutMs: 250, waitIntervalMs: 100})
    const expectation = expect(promise).rejects.toThrow(/did not become ready within 250ms/)
    await vi.advanceTimersByTimeAsync(1000)
    await expectation
  })

  it('bounds an endlessly-waiting status with the default 1h timeout', async () => {
    // No timeoutMs passed: a wait_status that never flips to ready (e.g. a
    // platform-side provisioning failure the data endpoint never reflects) must
    // still terminate rather than poll forever.
    const resolutionByAttachment = vi.fn().mockResolvedValue(buildAttachmentMatch({planName: 'heroku-postgresql:advanced-0'}))
    const waitStatus = vi.fn().mockResolvedValue({message: 'still waiting', waiting: true})
    const ctx = buildCtx({resolutionByAttachment, waitStatus})

    const promise = waitForReady(ctx, 'app-1', 'DATABASE_URL', {waitIntervalMs: 60_000})
    const expectation = expect(promise).rejects.toThrow(/did not become ready within 3600000ms/)
    await vi.advanceTimersByTimeAsync((60 * 60 * 1000) + 60_000)
    await expectation
  })

  it('throws immediately if the signal is already aborted', async () => {
    const resolutionByAttachment = vi.fn()
    const ctx = buildCtx({resolutionByAttachment})
    const controller = new AbortController()
    controller.abort()

    await expect(waitForReady(ctx, 'app-1', 'DATABASE_URL', {signal: controller.signal})).rejects.toThrow()
    expect(resolutionByAttachment).not.toHaveBeenCalled()
  })
})

describe('provisionAdvanced', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  it('builds the plan + config and creates the leader, dropping undefined config keys', async () => {
    const create = vi.fn().mockResolvedValue({id: 'new-addon', name: 'postgres-new', state: 'available'})
    const ctx = buildCtx({create})

    const {addon, pool, waitStatus} = await provisionAdvanced(ctx, 'app-1', {level: 'advanced-0'})

    expect(create).toHaveBeenCalledExactlyOnceWith('app-1', {
      attachment: {name: undefined},
      config: {level: 'advanced-0'},
      confirm: undefined,
      name: undefined,
      plan: 'heroku-postgresql:advanced',
    })
    // `toHaveBeenCalledExactlyOnceWith` treats a `version: undefined` key as
    // equal to an absent one, so assert the undefined config keys are dropped.
    expect(create.mock.calls[0][1].config).not.toHaveProperty('version')
    expect(addon.id).toBe('new-addon')
    expect(pool).toBeUndefined()
    expect(waitStatus).toBeUndefined()
  })

  it('includes high-availability and version, and lets extra config override them', async () => {
    const create = vi.fn().mockResolvedValue({id: 'new-addon', state: 'available'})
    const ctx = buildCtx({create})

    await provisionAdvanced(ctx, 'app-1', {
      config: {foo: 'bar', level: 'advanced-4'},
      highAvailability: true,
      level: 'advanced-0',
      version: '16',
    })

    expect(create).toHaveBeenCalledWith('app-1', expect.objectContaining({
      config: {
        foo: 'bar', 'high-availability': true, level: 'advanced-4', version: '16',
      },
    }))
  })

  it('selects the private/shield plan variant', async () => {
    const create = vi.fn().mockResolvedValue({id: 'new-addon', state: 'available'})
    const ctx = buildCtx({create})

    await provisionAdvanced(ctx, 'app-1', {level: 'advanced-0', network: 'private'})

    expect(create).toHaveBeenCalledWith('app-1', expect.objectContaining({plan: 'heroku-postgresql:advanced-private'}))
  })

  it('creates a follower pool with the leader level when followers > 0', async () => {
    const create = vi.fn().mockResolvedValue({id: 'new-addon', state: 'available'})
    const poolCreate = vi.fn().mockResolvedValue({expected_level: 'advanced-0', name: 'follower'})
    const ctx = buildCtx({create, poolCreate})

    const {pool} = await provisionAdvanced(ctx, 'app-1', {followers: 3, level: 'advanced-0'})

    expect(poolCreate).toHaveBeenCalledExactlyOnceWith('new-addon', {count: 3, level: 'advanced-0'})
    expect(pool).toEqual({expected_level: 'advanced-0', name: 'follower'})
  })

  it('waits on the data endpoint, firing onProvisioning before the first poll', async () => {
    const create = vi.fn().mockResolvedValue({id: 'new-addon', state: 'provisioning'})
    const waitStatus = vi.fn().mockResolvedValue({message: 'ready', waiting: false})
    const calls: string[] = []
    const onProvisioning = vi.fn(() => {
      calls.push('onProvisioning')
    })
    const ctx = buildCtx({create, waitStatus})
    waitStatus.mockImplementation(async () => {
      calls.push('waitStatus')
      return {message: 'ready', waiting: false}
    })

    const promise = provisionAdvanced(ctx, 'app-1', {level: 'advanced-0'}, {onProvisioning, wait: true})
    await vi.advanceTimersByTimeAsync(0)
    const {waitStatus: status} = await promise

    expect(calls).toEqual(['onProvisioning', 'waitStatus'])
    expect(waitStatus).toHaveBeenCalledWith('new-addon')
    expect(status).toEqual({message: 'ready', waiting: false})
  })

  it('captures a wait failure as waitError, keeps the created leader, and skips the follower pool', async () => {
    const create = vi.fn().mockResolvedValue({id: 'new-addon', state: 'provisioning'})
    const waitError = new Error('wait blew up')
    const waitStatus = vi.fn().mockRejectedValue(waitError)
    const poolCreate = vi.fn()
    const ctx = buildCtx({create, poolCreate, waitStatus})

    const promise = provisionAdvanced(ctx, 'app-1', {followers: 2, level: 'advanced-0'}, {wait: true, waitIntervalMs: 10})
    const result = await promise

    expect(result.addon.id).toBe('new-addon')
    expect(result.waitError).toBe(waitError)
    expect(result.waitStatus).toBeUndefined()
    // A failed wait must not provision a follower pool against an un-ready leader.
    expect(result.pool).toBeUndefined()
    expect(poolCreate).not.toHaveBeenCalled()
  })

  it('captures a follower-pool failure as poolError, keeping the ready leader and wait status', async () => {
    const create = vi.fn().mockResolvedValue({id: 'new-addon', state: 'provisioning'})
    const waitStatus = vi.fn().mockResolvedValue({message: 'ready', waiting: false})
    const poolError = new Error('pool blew up')
    const poolCreate = vi.fn().mockRejectedValue(poolError)
    const ctx = buildCtx({create, poolCreate, waitStatus})

    const promise = provisionAdvanced(ctx, 'app-1', {followers: 2, level: 'advanced-0'}, {wait: true, waitIntervalMs: 10})
    await vi.advanceTimersByTimeAsync(0)
    const result = await promise

    expect(result.addon.id).toBe('new-addon')
    expect(result.poolError).toBe(poolError)
    expect(result.pool).toBeUndefined()
    expect(result.waitStatus).toEqual({message: 'ready', waiting: false})
    expect(poolCreate).toHaveBeenCalledExactlyOnceWith('new-addon', {count: 2, level: 'advanced-0'})
  })

  it('converts a 423 confirmation_required into AddonConfirmationRequiredError', async () => {
    const create = vi.fn().mockRejectedValue(buildConfirmationRequired())
    const ctx = buildCtx({create})

    await expect(provisionAdvanced(ctx, 'app-1', {level: 'advanced-0'})).rejects.toBeInstanceOf(AddonConfirmationRequiredError)
  })

  it('throws immediately if the signal is already aborted', async () => {
    const create = vi.fn()
    const ctx = buildCtx({create})
    const controller = new AbortController()
    controller.abort()

    await expect(provisionAdvanced(ctx, 'app-1', {level: 'advanced-0'}, {signal: controller.signal})).rejects.toThrow()
    expect(create).not.toHaveBeenCalled()
  })
})

describe('fork', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  it('resolves the source, forks with the raw identity, and inherits the source plan', async () => {
    const addonResolution = vi.fn().mockResolvedValue(buildAddonMatch({id: 'source-addon', planName: 'heroku-postgresql:advanced-0'}))
    const create = vi.fn().mockResolvedValue({id: 'fork-addon', name: 'postgres-fork', state: 'available'})
    const ctx = buildCtx({addonResolution, create})

    const {addon, source} = await fork(ctx, 'app-1', 'postgres-source', {level: 'advanced-2'})

    expect(addonResolution).toHaveBeenCalledWith({addon: 'postgres-source', app: 'app-1'})
    expect(create).toHaveBeenCalledExactlyOnceWith('app-1', {
      attachment: {name: undefined},
      config: {fork: 'postgres-source', level: 'advanced-2'},
      confirm: undefined,
      name: undefined,
      plan: 'heroku-postgresql:advanced-0',
    })
    expect(addon.id).toBe('fork-addon')
    expect(source.id).toBe('source-addon')
  })

  it('fires onResolved with the resolved source before creating', async () => {
    const calls: string[] = []
    const addonResolution = vi.fn().mockResolvedValue(buildAddonMatch({id: 'source-addon', name: 'postgres-source', planName: 'heroku-postgresql:advanced-0'}))
    const create = vi.fn(() => {
      calls.push('create')
      return Promise.resolve({id: 'fork-addon', state: 'available'})
    })
    const onResolved = vi.fn(source => {
      calls.push('onResolved')
      expect(source.id).toBe('source-addon')
    })
    const ctx = buildCtx({addonResolution, create})

    await fork(ctx, 'app-1', 'postgres-source', {level: 'advanced-0'}, {onResolved})

    expect(onResolved).toHaveBeenCalledOnce()
    expect(calls).toEqual(['onResolved', 'create'])
  })

  it('defaults the level to the source leader pool when omitted', async () => {
    const addonResolution = vi.fn().mockResolvedValue(buildAddonMatch({id: 'source-addon', planName: 'heroku-postgresql:advanced-0'}))
    const info = vi.fn().mockResolvedValue({pools: [{expected_level: 'advanced-6', name: 'leader'}, {expected_level: 'advanced-0', name: 'follower'}]})
    const create = vi.fn().mockResolvedValue({id: 'fork-addon', state: 'available'})
    const ctx = buildCtx({addonResolution, create, info})

    await fork(ctx, 'app-1', 'postgres-source')

    expect(info).toHaveBeenCalledWith('source-addon')
    expect(create).toHaveBeenCalledWith('app-1', expect.objectContaining({
      config: {fork: 'postgres-source', level: 'advanced-6'},
    }))
  })

  it('builds a rollback config (not fork) with a UTC-formatted recovery time from a Date', async () => {
    const addonResolution = vi.fn().mockResolvedValue(buildAddonMatch({id: 'source-addon', planName: 'heroku-postgresql:advanced-0'}))
    const create = vi.fn().mockResolvedValue({id: 'fork-addon', state: 'available'})
    const ctx = buildCtx({addonResolution, create})

    await fork(ctx, 'app-1', 'postgres-source', {
      level: 'advanced-0',
      recoveryTime: new Date(Date.UTC(2026, 0, 2, 3, 4, 5, 678)),
    })

    const body = create.mock.calls[0][1]
    expect(body.config).toEqual({
      level: 'advanced-0',
      'recovery-time': '2026-01-02T03:04:05',
      rollback: 'postgres-source',
    })
    expect(body.config).not.toHaveProperty('fork')
  })

  it('passes a recovery-time string through verbatim', async () => {
    const addonResolution = vi.fn().mockResolvedValue(buildAddonMatch({id: 'source-addon', planName: 'heroku-postgresql:advanced-0'}))
    const create = vi.fn().mockResolvedValue({id: 'fork-addon', state: 'available'})
    const ctx = buildCtx({addonResolution, create})

    await fork(ctx, 'app-1', 'postgres-source', {level: 'advanced-0', recoveryTime: '2026-01-02T03:04:05'})

    expect(create).toHaveBeenCalledWith('app-1', expect.objectContaining({
      config: {level: 'advanced-0', 'recovery-time': '2026-01-02T03:04:05', rollback: 'postgres-source'},
    }))
  })

  it('throws NotAdvancedDatabaseError for a classic source without creating or firing onResolved', async () => {
    const addonResolution = vi.fn().mockResolvedValue(buildAddonMatch({id: 'source-addon', planName: 'heroku-postgresql:standard-0'}))
    const create = vi.fn()
    const onResolved = vi.fn()
    const ctx = buildCtx({addonResolution, create})

    const error = await fork(ctx, 'app-1', 'postgres-source', {level: 'advanced-0'}, {onResolved}).catch((error_: unknown) => error_)

    expect(error).toBeInstanceOf(NotAdvancedDatabaseError)
    expect((error as NotAdvancedDatabaseError).addon.id).toBe('source-addon')
    expect(create).not.toHaveBeenCalled()
    expect(onResolved).not.toHaveBeenCalled()
  })

  it('throws when the level is omitted and the source has no leader pool, before creating', async () => {
    const addonResolution = vi.fn().mockResolvedValue(buildAddonMatch({id: 'source-addon', name: 'postgres-source', planName: 'heroku-postgresql:advanced-0'}))
    const info = vi.fn().mockResolvedValue({pools: [{expected_level: 'advanced-0', name: 'follower'}]})
    const create = vi.fn()
    const ctx = buildCtx({addonResolution, create, info})

    await expect(fork(ctx, 'app-1', 'postgres-source')).rejects.toThrow(/no 'leader' pool/)
    expect(create).not.toHaveBeenCalled()
  })

  it('captures a wait failure as waitError, keeping the created fork', async () => {
    const addonResolution = vi.fn().mockResolvedValue(buildAddonMatch({id: 'source-addon', planName: 'heroku-postgresql:advanced-0'}))
    const create = vi.fn().mockResolvedValue({id: 'fork-addon', state: 'provisioning'})
    const waitError = new Error('wait blew up')
    const waitStatus = vi.fn().mockRejectedValue(waitError)
    const ctx = buildCtx({addonResolution, create, waitStatus})

    const result = await fork(ctx, 'app-1', 'postgres-source', {level: 'advanced-0'}, {wait: true, waitIntervalMs: 10})

    expect(result.addon.id).toBe('fork-addon')
    expect(result.source.id).toBe('source-addon')
    expect(result.waitError).toBe(waitError)
    expect(result.waitStatus).toBeUndefined()
  })
})
