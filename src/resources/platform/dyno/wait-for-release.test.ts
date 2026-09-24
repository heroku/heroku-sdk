import type {Dyno} from '@heroku/types/3.sdk'

import {
  describe, expect, it, vi,
} from 'vitest'

import {ReleaseNotConvergedError, waitForRelease} from './wait-for-release.js'

function dyno(overrides: Partial<Dyno> & {release?: {version: number}}): Dyno {
  return {state: 'up', type: 'web', ...overrides} as Dyno
}

/**
 * Builds a partial-but-typed ctx for waitForRelease. `withOptions`
 * and `withHeaders` return the same platform so the release/dyno
 * stubs are always hit; the platform is returned for assertions.
 */
function ctxWith(releaseList: ReturnType<typeof vi.fn>, dynoList: ReturnType<typeof vi.fn>) {
  const platform = {
    dyno: {list: dynoList},
    release: {list: releaseList},
  } as Record<string, unknown>
  platform.withOptions = vi.fn().mockReturnValue(platform)
  platform.withHeaders = vi.fn().mockReturnValue(platform)
  return {ctx: {platform: platform as never}, platform}
}

describe('waitForRelease', () => {
  it('returns undefined when the app has no releases', async () => {
    const {ctx} = ctxWith(vi.fn().mockResolvedValue([]), vi.fn())

    const result = await waitForRelease(ctx, 'app-1', {delayMs: 1})

    expect(result).toBeUndefined()
  })

  it('returns undefined when the latest release has no version', async () => {
    const {ctx} = ctxWith(vi.fn().mockResolvedValue([{}]), vi.fn())

    const result = await waitForRelease(ctx, 'app-1', {delayMs: 1})

    expect(result).toBeUndefined()
  })

  it('resolves immediately without firing onPoll when the fleet is already converged', async () => {
    const releaseList = vi.fn().mockResolvedValue([{version: 5}])
    const dynoList = vi.fn().mockResolvedValue([dyno({release: {version: 5}, state: 'up', type: 'web'})])
    const {ctx, platform} = ctxWith(releaseList, dynoList)
    const onPoll = vi.fn()

    const result = await waitForRelease(ctx, 'app-1', {delayMs: 1, onPoll})

    expect(result).toEqual({total: 1, version: 5})
    expect(onPoll).not.toHaveBeenCalled()
    expect(platform.withHeaders).toHaveBeenCalledWith({Range: 'version ..; max=1, order=desc'})
    expect(dynoList).toHaveBeenCalledTimes(1)
  })

  it('polls until converged, firing onPoll on each non-converged poll', async () => {
    const releaseList = vi.fn().mockResolvedValue([{version: 5}])
    const dynoList = vi.fn()
      .mockResolvedValueOnce([dyno({release: {version: 4}, state: 'up', type: 'web'})])
      .mockResolvedValueOnce([dyno({release: {version: 5}, state: 'starting', type: 'web'})])
      .mockResolvedValueOnce([dyno({release: {version: 5}, state: 'up', type: 'web'})])
    const {ctx} = ctxWith(releaseList, dynoList)
    const onPoll = vi.fn()

    const result = await waitForRelease(ctx, 'app-1', {delayMs: 1, onPoll})

    expect(result).toEqual({total: 1, version: 5})
    expect(onPoll).toHaveBeenCalledTimes(2)
    expect(onPoll).toHaveBeenNthCalledWith(1, {onLatest: 0, total: 1, version: 5})
    expect(onPoll).toHaveBeenNthCalledWith(2, {onLatest: 0, total: 1, version: 5})
    expect(dynoList).toHaveBeenCalledTimes(3)
  })

  it('excludes release dynos and, by default, one-off run dynos', async () => {
    const releaseList = vi.fn().mockResolvedValue([{version: 5}])
    const dynoList = vi.fn().mockResolvedValue([
      dyno({release: {version: 5}, state: 'up', type: 'web'}),
      dyno({release: {version: 5}, state: 'down', type: 'release'}),
      dyno({release: {version: 5}, state: 'down', type: 'run'}),
    ])
    const {ctx} = ctxWith(releaseList, dynoList)

    const result = await waitForRelease(ctx, 'app-1', {delayMs: 1})

    // Only the web dyno counts, and it is up on latest -> converged with total 1.
    expect(result).toEqual({total: 1, version: 5})
  })

  it('includes run dynos when withRun is set', async () => {
    const releaseList = vi.fn().mockResolvedValue([{version: 5}])
    const dynoList = vi.fn()
      .mockResolvedValueOnce([
        dyno({release: {version: 5}, state: 'up', type: 'web'}),
        dyno({release: {version: 5}, state: 'starting', type: 'run'}),
      ])
      .mockResolvedValueOnce([
        dyno({release: {version: 5}, state: 'up', type: 'web'}),
        dyno({release: {version: 5}, state: 'up', type: 'run'}),
      ])
    const {ctx} = ctxWith(releaseList, dynoList)
    const onPoll = vi.fn()

    const result = await waitForRelease(ctx, 'app-1', {delayMs: 1, onPoll, withRun: true})

    expect(result).toEqual({total: 2, version: 5})
    expect(onPoll).toHaveBeenCalledExactlyOnceWith({onLatest: 1, total: 2, version: 5})
  })

  it('restricts the wait to a single process type', async () => {
    const releaseList = vi.fn().mockResolvedValue([{version: 5}])
    const dynoList = vi.fn().mockResolvedValue([
      dyno({release: {version: 5}, state: 'up', type: 'web'}),
      dyno({release: {version: 4}, state: 'up', type: 'worker'}),
    ])
    const {ctx} = ctxWith(releaseList, dynoList)

    const result = await waitForRelease(ctx, 'app-1', {delayMs: 1, type: 'web'})

    // worker is behind but filtered out, so web-only fleet is converged.
    expect(result).toEqual({total: 1, version: 5})
  })

  it('waits on run dynos when type is "run" instead of silently resolving empty', async () => {
    const releaseList = vi.fn().mockResolvedValue([{version: 5}])
    const dynoList = vi.fn()
      .mockResolvedValueOnce([
        dyno({release: {version: 4}, state: 'up', type: 'run'}),
        dyno({release: {version: 5}, state: 'up', type: 'web'}),
      ])
      .mockResolvedValueOnce([
        dyno({release: {version: 5}, state: 'up', type: 'run'}),
        dyno({release: {version: 5}, state: 'up', type: 'web'}),
      ])
    const {ctx} = ctxWith(releaseList, dynoList)
    const onPoll = vi.fn()

    const result = await waitForRelease(ctx, 'app-1', {delayMs: 1, onPoll, type: 'run'})

    // Only the run dyno counts, and the wait actually polled until it
    // reached the latest release — not a first-poll {total: 0} no-op.
    expect(result).toEqual({total: 1, version: 5})
    expect(onPoll).toHaveBeenCalledExactlyOnceWith({onLatest: 0, total: 1, version: 5})
    expect(dynoList).toHaveBeenCalledTimes(2)
  })

  it('throws ReleaseNotConvergedError once attempts is exhausted', async () => {
    const releaseList = vi.fn().mockResolvedValue([{version: 5}])
    const dynoList = vi.fn().mockResolvedValue([dyno({release: {version: 4}, state: 'up', type: 'web'})])
    const {ctx} = ctxWith(releaseList, dynoList)

    await expect(waitForRelease(ctx, 'app-1', {attempts: 3, delayMs: 1}))
      .rejects.toBeInstanceOf(ReleaseNotConvergedError)
    expect(dynoList).toHaveBeenCalledTimes(3)
  })

  it('resolves normally within the attempts cap without throwing', async () => {
    const releaseList = vi.fn().mockResolvedValue([{version: 5}])
    const dynoList = vi.fn()
      .mockResolvedValueOnce([dyno({release: {version: 4}, state: 'up', type: 'web'})])
      .mockResolvedValueOnce([dyno({release: {version: 5}, state: 'up', type: 'web'})])
    const {ctx} = ctxWith(releaseList, dynoList)

    const result = await waitForRelease(ctx, 'app-1', {attempts: 5, delayMs: 1})

    expect(result).toEqual({total: 1, version: 5})
    expect(dynoList).toHaveBeenCalledTimes(2)
  })

  it('scopes the platform client to the caller signal', async () => {
    const releaseList = vi.fn().mockResolvedValue([{version: 5}])
    const dynoList = vi.fn().mockResolvedValue([dyno({release: {version: 5}, state: 'up', type: 'web'})])
    const {ctx, platform} = ctxWith(releaseList, dynoList)
    const controller = new AbortController()

    await waitForRelease(ctx, 'app-1', {delayMs: 1, signal: controller.signal})

    expect(platform.withOptions).toHaveBeenCalledWith({signal: controller.signal})
  })

  it('throws immediately when the signal is already aborted', async () => {
    const releaseList = vi.fn()
    const {ctx} = ctxWith(releaseList, vi.fn())
    const controller = new AbortController()
    controller.abort()

    await expect(waitForRelease(ctx, 'app-1', {signal: controller.signal})).rejects.toThrow()
    expect(releaseList).not.toHaveBeenCalled()
  })
})
