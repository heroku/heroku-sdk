import type {TestRun} from '@heroku/types/3.sdk'

import {
  afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest'

import type {ResourceCtx} from '../../../core/extend-resource.js'

import {HerokuSDK} from '../../../core/heroku-sdk.js'
import {testRunExtensions} from './index.js'
import {TestRunNotReadyError, waitForState} from './wait-for-state.js'

function testRun(status: TestRun['status'], overrides: Partial<TestRun> = {}): TestRun {
  return {
    id: 'tr-1', number: 42, status, ...overrides,
  } as TestRun
}

/**
 * Build a platform-only ctx whose `testRun.infoByPipeline` resolves the
 * supplied runs in order. `withOptions` returns the same platform so a
 * signal-scoped call still reaches the same mock.
 */
function ctxFor(runs: TestRun[]): {
  ctx: ResourceCtx
  infoByPipeline: ReturnType<typeof vi.fn>
} {
  const infoByPipeline = vi.fn()
  for (const run of runs) infoByPipeline.mockResolvedValueOnce(run)
  const platform: Record<string, unknown> = {testRun: {infoByPipeline}}
  platform.withOptions = vi.fn().mockReturnValue(platform)
  return {ctx: {data: {} as never, platform: platform as never}, infoByPipeline}
}

/** Variant whose `infoByPipeline` always resolves the same run. */
function ctxAlways(run: TestRun): {
  ctx: ResourceCtx
  infoByPipeline: ReturnType<typeof vi.fn>
} {
  const infoByPipeline = vi.fn().mockResolvedValue(run)
  const platform: Record<string, unknown> = {testRun: {infoByPipeline}}
  platform.withOptions = vi.fn().mockReturnValue(platform)
  return {ctx: {data: {} as never, platform: platform as never}, infoByPipeline}
}

describe('test-run waitForState', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  it('returns immediately when the seed poll status is already in targetStates', async () => {
    const done = testRun('debugging')
    const {ctx, infoByPipeline} = ctxFor([done])

    const result = await waitForState(ctx, 'pipeline-1', 42, ['debugging'])

    expect(result).toBe(done)
    expect(infoByPipeline).toHaveBeenCalledTimes(1)
    expect(infoByPipeline).toHaveBeenCalledWith('pipeline-1', 42)
  })

  it('polls repeatedly (building -> running -> debugging) and returns on match, spaced by intervalMs', async () => {
    const done = testRun('debugging')
    const {ctx, infoByPipeline} = ctxFor([
      testRun('building'),
      testRun('running'),
      done,
    ])

    const promise = waitForState(ctx, 'pipeline-1', 42, ['debugging'], {intervalMs: 1000})
    // First poll fires before any wait; flush the initial microtask.
    await vi.advanceTimersByTimeAsync(0)
    expect(infoByPipeline).toHaveBeenCalledTimes(1)
    // Still inside the first interval — no second poll yet. (Would fail if
    // the loop skipped wait() and polled straight through.)
    await vi.advanceTimersByTimeAsync(999)
    expect(infoByPipeline).toHaveBeenCalledTimes(1)
    // Cross the first interval boundary — second poll fires.
    await vi.advanceTimersByTimeAsync(1)
    expect(infoByPipeline).toHaveBeenCalledTimes(2)
    // Cross the second interval — third poll matches and resolves.
    await vi.advanceTimersByTimeAsync(1000)
    const result = await promise

    expect(result).toBe(done)
    expect(infoByPipeline).toHaveBeenCalledTimes(3)
  })

  it('throws TestRunNotReadyError carrying the last run and expected states when timeoutMs elapses', async () => {
    const stuck = testRun('building')
    const {ctx} = ctxAlways(stuck)

    const promise = waitForState(ctx, 'pipeline-1', 42, ['succeeded'], {intervalMs: 100, timeoutMs: 250})
    const expectation = promise.then(
      () => {
        throw new Error('expected waitForState to reject')
      },
      (error: unknown) => error,
    )
    await vi.advanceTimersByTimeAsync(1000)
    const error = await expectation

    expect(error).toBeInstanceOf(TestRunNotReadyError)
    const notReady = error as TestRunNotReadyError
    expect(notReady.testRun).toBe(stuck)
    expect(notReady.expectedStates).toEqual(['succeeded'])
    expect(notReady.timeoutMs).toBe(250)
  })

  it('rejects when the signal is already aborted, without polling', async () => {
    const {ctx, infoByPipeline} = ctxFor([testRun('debugging')])
    const controller = new AbortController()
    controller.abort()

    await expect(waitForState(ctx, 'pipeline-1', 42, ['debugging'], {signal: controller.signal})).rejects.toThrow()
    expect(infoByPipeline).not.toHaveBeenCalled()
  })

  it('rejects when the signal aborts mid-wait', async () => {
    const {ctx, infoByPipeline} = ctxAlways(testRun('building'))
    const controller = new AbortController()

    const promise = waitForState(ctx, 'pipeline-1', 42, ['succeeded'], {
      intervalMs: 1000,
      signal: controller.signal,
    })
    const expectation = expect(promise).rejects.toThrow()
    // Let the first poll resolve and the loop enter wait().
    await vi.advanceTimersByTimeAsync(0)
    controller.abort()
    await vi.advanceTimersByTimeAsync(0)
    await expectation

    expect(infoByPipeline).toHaveBeenCalledTimes(1)
  })

  it('fires onPoll for every observed run including the terminal one', async () => {
    const running = testRun('running')
    const done = testRun('debugging')
    const {ctx} = ctxFor([running, done])
    const onPoll = vi.fn()

    const promise = waitForState(ctx, 'pipeline-1', 42, ['debugging'], {intervalMs: 1000, onPoll})
    await vi.advanceTimersByTimeAsync(1000)
    await promise

    expect(onPoll).toHaveBeenCalledTimes(2)
    expect(onPoll).toHaveBeenNthCalledWith(1, running)
    expect(onPoll).toHaveBeenNthCalledWith(2, done)
  })

  it('testRunExtensions declares service: platform, resource: testRun, and exposes waitForState', () => {
    expect(testRunExtensions.service).toBe('platform')
    expect(testRunExtensions.resource).toBe('testRun')

    const platform: Record<string, unknown> = {testRun: {}}
    platform.withOptions = vi.fn().mockReturnValue(platform)
    const methods = testRunExtensions.factory({data: {} as never, platform: platform as never})
    expect(typeof methods.waitForState).toBe('function')
  })

  it('resolves platform.testRun.waitForState on a real HerokuSDK client', () => {
    const sdk = new HerokuSDK({extensions: [testRunExtensions]})
    expect(typeof sdk.platform.testRun.waitForState).toBe('function')
  })
})
