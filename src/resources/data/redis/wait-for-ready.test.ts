import {NotFoundError} from '@heroku/heroku-fetch'
import {
  afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest'

import type {ResourceCtx} from '../../../core/extend-resource.js'

import {redisExtensions} from './index.js'
import {waitForRedisReady} from './wait-for-ready.js'

type WaitFn = ReturnType<typeof vi.fn>

function buildNotFound(): NotFoundError {
  const response = new Response(JSON.stringify({id: 'not_found', resource: 'redis'}), {
    headers: {'content-type': 'application/json'},
    status: 404,
  })
  return new NotFoundError(response, {id: 'not_found', resource: 'redis'})
}

function buildCtx(waitMock: WaitFn): ResourceCtx {
  const dataClient = {
    redis: {wait: waitMock},
    withOptions() {
      return dataClient
    },
  }
  return {
    data: dataClient as never,
    platform: {} as never,
  }
}

describe('waitForRedisReady', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  it('returns immediately when waiting? is already false', async () => {
    const waitMock = vi.fn().mockResolvedValue({message: 'ready', 'waiting?': false})
    const ctx = buildCtx(waitMock)

    const result = await waitForRedisReady(ctx, 'redis-alpha-1')

    expect(waitMock).toHaveBeenCalledExactlyOnceWith('redis-alpha-1')
    expect(result).toEqual({message: 'ready', 'waiting?': false})
  })

  it('polls until waiting? flips false', async () => {
    const waitMock = vi.fn()
      .mockResolvedValueOnce({message: 'provisioning', 'waiting?': true})
      .mockResolvedValueOnce({message: 'provisioning', 'waiting?': true})
      .mockResolvedValueOnce({message: 'ready', 'waiting?': false})
    const ctx = buildCtx(waitMock)

    const promise = waitForRedisReady(ctx, 'redis-alpha-1', {intervalMs: 100})

    await vi.advanceTimersByTimeAsync(0)
    expect(waitMock).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(100)
    expect(waitMock).toHaveBeenCalledTimes(2)

    await vi.advanceTimersByTimeAsync(100)

    const result = await promise
    expect(waitMock).toHaveBeenCalledTimes(3)
    expect(result).toEqual({message: 'ready', 'waiting?': false})
  })

  it('tolerates 404 during the initial provisioning window', async () => {
    const waitMock = vi.fn()
      .mockRejectedValueOnce(buildNotFound())
      .mockResolvedValueOnce({message: 'ready', 'waiting?': false})
    const ctx = buildCtx(waitMock)

    const promise = waitForRedisReady(ctx, 'redis-alpha-1', {intervalMs: 50})

    await vi.advanceTimersByTimeAsync(50)
    const result = await promise

    expect(waitMock).toHaveBeenCalledTimes(2)
    expect(result).toEqual({message: 'ready', 'waiting?': false})
  })

  it('propagates non-404 errors', async () => {
    const waitMock = vi.fn().mockRejectedValue(new Error('boom'))
    const ctx = buildCtx(waitMock)

    await expect(waitForRedisReady(ctx, 'redis-alpha-1', {intervalMs: 10})).rejects.toThrow('boom')
  })

  it('throws when timeoutMs elapses before ready', async () => {
    const waitMock = vi.fn().mockResolvedValue({message: 'still waiting', 'waiting?': true})
    const ctx = buildCtx(waitMock)

    const promise = waitForRedisReady(ctx, 'redis-alpha-1', {intervalMs: 100, timeoutMs: 250})
    const expectation = expect(promise).rejects.toThrow(/did not become ready within 250ms/)
    await vi.advanceTimersByTimeAsync(1000)
    await expectation
  })

  it('throws immediately if the abort signal is already aborted', async () => {
    const waitMock = vi.fn()
    const ctx = buildCtx(waitMock)
    const controller = new AbortController()
    controller.abort()

    await expect(waitForRedisReady(ctx, 'redis-alpha-1', {signal: controller.signal})).rejects.toThrow()
    expect(waitMock).not.toHaveBeenCalled()
  })

  it('aborts the poll delay when the signal fires', async () => {
    const waitMock = vi.fn().mockResolvedValue({message: 'still waiting', 'waiting?': true})
    const ctx = buildCtx(waitMock)
    const controller = new AbortController()

    const promise = waitForRedisReady(ctx, 'redis-alpha-1', {
      intervalMs: 5000, signal: controller.signal,
    })
    const expectation = expect(promise).rejects.toThrow(/aborted/i)
    controller.abort()
    await vi.advanceTimersByTimeAsync(0)
    await expectation
  })
})

describe('redisExtensions', () => {
  it('declares service: data, resource: redis', () => {
    expect(redisExtensions.service).toBe('data')
    expect(redisExtensions.resource).toBe('redis')
  })

  it('factory exposes resolveByApp and waitForReady', () => {
    const methods = redisExtensions.factory({data: {} as never, platform: {} as never})
    expect(typeof methods.resolveByApp).toBe('function')
    expect(typeof methods.waitForReady).toBe('function')
  })
})
