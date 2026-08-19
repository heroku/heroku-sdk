/* eslint-disable camelcase */
import type {Space, SpaceNat} from '@heroku/types/3.sdk'

import {
  afterEach, describe, expect, it, vi,
} from 'vitest'

import type {ResourceCtx} from '../../../core/extend-resource.js'

import {SpaceNotAllocatedError, SpaceNotReadyError} from './errors.js'
import {waitForAllocated} from './wait-for-allocated.js'

// Used to avoid timeouts in tests
const WAIT_INTERVAL_MS = 5

type FakePlatform = {
  space: {
    info: ReturnType<typeof vi.fn>
  }
  spaceNat: {
    info: ReturnType<typeof vi.fn>
  }
  withHeaders: ReturnType<typeof vi.fn>
  withOptions: ReturnType<typeof vi.fn>
}

function buildCtx(stubs: {
  info?: ReturnType<typeof vi.fn>
  natInfo?: ReturnType<typeof vi.fn>
} = {}): ResourceCtx {
  const platform: FakePlatform = {
    space: {
      info: stubs.info ?? vi.fn().mockResolvedValue({}),
    },
    spaceNat: {
      info: stubs.natInfo ?? vi.fn().mockResolvedValue({}),
    },
    withHeaders: vi.fn(function (this: any) {
      return this
    }),
    withOptions: vi.fn(function (this: any) {
      return this
    }),
  }
  platform.withHeaders.mockReturnValue(platform)
  platform.withOptions.mockReturnValue(platform)

  return {
    data: {} as never,
    metrics: {} as never,
    platform: platform as never,
    repositories: {} as never,
  }
}

function buildSpace(overrides: Partial<Space> = {}): Space {
  return {
    cidr: '10.0.0.0/16',
    created_at: '2020-01-01T00:00:00Z',
    data_cidr: '10.1.0.0/20',
    generation: 'cedar',
    id: 'space-1',
    name: 'my-space',
    organization: {name: 'my-org'},
    region: {id: 'region-1', name: 'virginia'},
    shield: false,
    state: 'allocated',
    team: {id: 'team-1', name: 'my-team'},
    updated_at: '2020-01-01T00:00:00Z',
    ...overrides,
  }
}

function buildSpaceNat(overrides: Partial<SpaceNat> = {}): SpaceNat {
  return {
    created_at: '2020-01-01T00:00:00Z',
    sources: ['1.1.1.1'],
    state: 'enabled',
    updated_at: '2020-01-01T00:00:00Z',
    ...overrides,
  }
}

describe('waitForAllocated', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('waits for the space to become allocated', async () => {
    const allocating = buildSpace({state: 'allocating'})
    const allocated = buildSpace({state: 'allocated'})
    const ctx = buildCtx({
      info: vi.fn()
        .mockResolvedValueOnce(allocating)
        .mockResolvedValueOnce(allocating)
        .mockResolvedValueOnce(allocated),
    })

    const result = await waitForAllocated(ctx, 'my-space', {intervalMs: WAIT_INTERVAL_MS})

    expect(result).toEqual(allocated)
    expect(ctx.platform.space.info).toHaveBeenCalledTimes(3)
  })

  it('throws SpaceNotAllocatedError when the terminal state is not allocated', async () => {
    const allocating = buildSpace({state: 'allocating'})
    const deleting = buildSpace({state: 'deleting'})
    const ctx = buildCtx({
      info: vi.fn()
        .mockResolvedValueOnce(allocating)
        .mockResolvedValueOnce(deleting),
    })

    try {
      await waitForAllocated(ctx, 'my-space', {intervalMs: WAIT_INTERVAL_MS})
      expect.fail('Expected SpaceNotAllocatedError to be thrown')
    } catch (error) {
      expect(error).toBeInstanceOf(SpaceNotAllocatedError)

      const e = error as SpaceNotAllocatedError

      expect(e.space).toEqual(deleting)
      expect(ctx.platform.space.info).toHaveBeenCalledTimes(2)
    }
  })

  it('respects timeout', async () => {
    const allocating = buildSpace({state: 'allocating'})
    const ctx = buildCtx({
      info: vi.fn().mockResolvedValue(allocating),
    })

    try {
      await waitForAllocated(ctx, 'my-space', {
        intervalMs: WAIT_INTERVAL_MS,
        timeoutMs: WAIT_INTERVAL_MS * 2,
      })
      expect.fail('Expected SpaceNotReadyError to be thrown')
    } catch (error) {
      expect(error).toBeInstanceOf(SpaceNotReadyError)

      const e = error as SpaceNotReadyError

      expect(e.timeoutMs).toEqual(WAIT_INTERVAL_MS * 2)
      expect(e.message).toEqual(`Timeout waiting for space ${allocating.name} to become allocated.`)
      // depending on the speed of the test, we may have more calls, but we should have at least 2
      // call 1: before loop starts
      // call 2: first loop iteration
      expect(vi.mocked(ctx.platform.space.info).mock.calls.length).toBeGreaterThanOrEqual(2)
    }
  })

  it('attaches NAT info when includeNat is set', async () => {
    const allocated = buildSpace({state: 'allocated'})
    const nat = buildSpaceNat()
    const ctx = buildCtx({
      info: vi.fn().mockResolvedValue(allocated),
      natInfo: vi.fn().mockResolvedValue(nat),
    })

    const result = await waitForAllocated(ctx, 'my-space', {
      includeNat: true,
      intervalMs: WAIT_INTERVAL_MS,
    })

    expect(result).toEqual({...allocated, nat})
    expect(ctx.platform.spaceNat.info).toHaveBeenCalledWith('my-space')
  })

  it('soft-fails the NAT fetch: returns the space without nat when spaceNat.info rejects', async () => {
    const allocated = buildSpace({state: 'allocated'})
    const ctx = buildCtx({
      info: vi.fn().mockResolvedValue(allocated),
      natInfo: vi.fn().mockRejectedValue(new Error('nat fetch failed')),
    })

    const result = await waitForAllocated(ctx, 'my-space', {
      includeNat: true,
      intervalMs: WAIT_INTERVAL_MS,
    })

    expect(result).toEqual(allocated)
    expect(result.nat).toBeUndefined()
  })

  it('does not fetch NAT info when includeNat is not set', async () => {
    const allocated = buildSpace({state: 'allocated'})
    const ctx = buildCtx({
      info: vi.fn().mockResolvedValue(allocated),
    })

    const result = await waitForAllocated(ctx, 'my-space', {intervalMs: WAIT_INTERVAL_MS})

    expect(result).toEqual(allocated)
    expect(ctx.platform.spaceNat.info).not.toHaveBeenCalled()
  })

  it('rejects when the signal is already aborted, without polling', async () => {
    const allocated = buildSpace({state: 'allocated'})
    const ctx = buildCtx({
      info: vi.fn().mockResolvedValue(allocated),
    })
    const controller = new AbortController()
    controller.abort()

    await expect(waitForAllocated(ctx, 'my-space', {
      intervalMs: WAIT_INTERVAL_MS,
      signal: controller.signal,
    })).rejects.toThrow()
    expect(ctx.platform.space.info).not.toHaveBeenCalled()
  })
})
