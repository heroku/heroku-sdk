import type {Dyno} from '@heroku/types/3.sdk'

import {HerokuApiError, NotFoundError, RateLimitError} from '@heroku/heroku-fetch'
import {
  describe, expect, it, vi,
} from 'vitest'

import {DynoNotReadyError, waitForInfo} from './wait-for-info.js'

function buildNotFound(): NotFoundError {
  const response = new Response(JSON.stringify({id: 'not_found', resource: 'dyno'}), {
    headers: {'content-type': 'application/json'},
    status: 404,
  })
  return new NotFoundError(response, {id: 'not_found', resource: 'dyno'})
}

function buildRateLimit(retryAfterSeconds?: number): RateLimitError {
  const headers: Record<string, string> = {'content-type': 'application/json'}
  if (retryAfterSeconds !== undefined) headers['retry-after'] = String(retryAfterSeconds)
  const response = new Response(JSON.stringify({id: 'rate_limit'}), {headers, status: 429})
  const error = new RateLimitError(response, {id: 'rate_limit'})
  if (retryAfterSeconds !== undefined) error.retryAfter = retryAfterSeconds
  return error
}

function buildServiceUnavailable(): HerokuApiError {
  const response = new Response('', {status: 503})
  return new HerokuApiError('service unavailable', 503, response)
}

/**
 * Builds a partial-but-typed ctx for waitForInfo. The helper calls
 * `ctx.platform.withOptions({signal})` when a signal is passed; the
 * mock returns the same platform so subsequent `info` calls hit the
 * supplied stub.
 */
function ctxWithInfo(info: ReturnType<typeof vi.fn>): Parameters<typeof waitForInfo>[0] {
  const platform = {dyno: {info}} as unknown as Record<string, unknown>
  platform.withOptions = vi.fn().mockReturnValue(platform)
  return {platform: platform as never}
}

describe('waitForInfo', () => {
  it('returns immediately on the first 2xx when no states are provided', async () => {
    const dyno = {name: 'web.1', state: 'starting'} as Dyno
    const info = vi.fn().mockResolvedValueOnce(dyno)

    const result = await waitForInfo(ctxWithInfo(info), 'app-1', 'web.1', {delayMs: 1})

    expect(result).toBe(dyno)
    expect(info).toHaveBeenCalledExactlyOnceWith('app-1', 'web.1')
  })

  it('returns even on a non-runnable state when no states filter is set', async () => {
    // Race-only consumers (vscode resource explorer) accept any 2xx.
    const dyno = {name: 'web.1', state: 'crashed'} as Dyno
    const info = vi.fn().mockResolvedValueOnce(dyno)

    const result = await waitForInfo(ctxWithInfo(info), 'app-1', 'web.1', {delayMs: 1})

    expect(result.state).toBe('crashed')
  })

  it('retries past 404s until the dyno appears', async () => {
    const dyno = {name: 'web.1', state: 'starting'} as Dyno
    const info = vi.fn()
      .mockRejectedValueOnce(buildNotFound())
      .mockRejectedValueOnce(buildNotFound())
      .mockResolvedValueOnce(dyno)

    const result = await waitForInfo(ctxWithInfo(info), 'app-1', 'web.1', {delayMs: 1})

    expect(result).toBe(dyno)
    expect(info).toHaveBeenCalledTimes(3)
  })

  it('retries past 429 rate-limit errors', async () => {
    const dyno = {name: 'web.1', state: 'up'} as Dyno
    const info = vi.fn()
      .mockRejectedValueOnce(buildRateLimit())
      .mockResolvedValueOnce(dyno)

    const result = await waitForInfo(ctxWithInfo(info), 'app-1', 'web.1', {delayMs: 1})

    expect(result).toBe(dyno)
    expect(info).toHaveBeenCalledTimes(2)
  })

  it('honors Retry-After when 429 is returned', async () => {
    vi.useFakeTimers()
    try {
      const dyno = {name: 'web.1', state: 'up'} as Dyno
      const info = vi.fn()
        .mockRejectedValueOnce(buildRateLimit(2)) // 2-second retry-after
        .mockResolvedValueOnce(dyno)

      // Default delayMs=1000; with retryAfter=2 the next wait is 2000ms.
      const promise = waitForInfo(ctxWithInfo(info), 'app-1', 'web.1')
      // Fully drain microtasks for the awaited rejection to land before advancing.
      await vi.advanceTimersByTimeAsync(0)
      // After 1.5s the second call must NOT have happened yet (retry-after dominates).
      await vi.advanceTimersByTimeAsync(1500)
      expect(info).toHaveBeenCalledTimes(1)
      // Past 2s total, the second call fires.
      await vi.advanceTimersByTimeAsync(600)
      const result = await promise
      expect(result).toBe(dyno)
      expect(info).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('retries past 503 service-unavailable errors', async () => {
    const dyno = {name: 'web.1', state: 'up'} as Dyno
    const info = vi.fn()
      .mockRejectedValueOnce(buildServiceUnavailable())
      .mockResolvedValueOnce(dyno)

    const result = await waitForInfo(ctxWithInfo(info), 'app-1', 'web.1', {delayMs: 1})

    expect(result).toBe(dyno)
    expect(info).toHaveBeenCalledTimes(2)
  })

  it('keeps polling until state is in the requested set', async () => {
    const info = vi.fn()
      .mockResolvedValueOnce({name: 'web.1', state: 'down'} as Dyno)
      .mockResolvedValueOnce({name: 'web.1', state: 'idle'} as Dyno)
      .mockResolvedValueOnce({name: 'web.1', state: 'starting'} as Dyno)

    const result = await waitForInfo(ctxWithInfo(info), 'app-1', 'web.1', {
      delayMs: 1,
      states: ['starting', 'up'],
    })

    expect(result.state).toBe('starting')
    expect(info).toHaveBeenCalledTimes(3)
  })

  it('mixes 404s and wrong-state responses when state-filtered', async () => {
    const info = vi.fn()
      .mockRejectedValueOnce(buildNotFound())
      .mockResolvedValueOnce({name: 'web.1', state: 'down'} as Dyno)
      .mockResolvedValueOnce({name: 'web.1', state: 'up'} as Dyno)

    const result = await waitForInfo(ctxWithInfo(info), 'app-1', 'web.1', {
      delayMs: 1,
      states: ['up'],
    })

    expect(result.state).toBe('up')
    expect(info).toHaveBeenCalledTimes(3)
  })

  it('throws non-transient errors immediately without retrying', async () => {
    const authError = new HerokuApiError('Unauthorized', 401)
    const info = vi.fn().mockRejectedValueOnce(authError)

    await expect(waitForInfo(ctxWithInfo(info), 'app-1', 'web.1', {delayMs: 1})).rejects.toBe(authError)
    expect(info).toHaveBeenCalledTimes(1)
  })

  it('throws a 500 immediately (5xx other than 503 are not transient)', async () => {
    const serverError = new HerokuApiError('Internal Server Error', 500)
    const info = vi.fn().mockRejectedValueOnce(serverError)

    await expect(waitForInfo(ctxWithInfo(info), 'app-1', 'web.1', {delayMs: 1})).rejects.toBe(serverError)
    expect(info).toHaveBeenCalledTimes(1)
  })

  it('exhausts attempts on persistent 404 and rethrows the *last* NotFoundError', async () => {
    const lastError = buildNotFound()
    const info = vi.fn()
      .mockRejectedValueOnce(buildNotFound())
      .mockRejectedValueOnce(buildNotFound())
      .mockRejectedValueOnce(lastError)

    await expect(waitForInfo(ctxWithInfo(info), 'app-1', 'web.1', {attempts: 3, delayMs: 1})).rejects.toBe(lastError)
    expect(info).toHaveBeenCalledTimes(3)
  })

  it('throws DynoNotReadyError when state never matches', async () => {
    const info = vi.fn().mockResolvedValue({name: 'web.1', state: 'crashed'} as Dyno)

    const error = await waitForInfo(ctxWithInfo(info), 'app-1', 'web.1', {
      attempts: 3,
      delayMs: 1,
      states: ['up'],
    }).catch(error_ => error_)

    expect(error).toBeInstanceOf(DynoNotReadyError)
    expect((error as DynoNotReadyError).dyno.state).toBe('crashed')
    expect((error as DynoNotReadyError).expectedStates).toEqual(['up'])
    expect((error as DynoNotReadyError).attempts).toBe(3)
    expect(info).toHaveBeenCalledTimes(3)
  })

  it('calls onPoll for every successful info, including non-terminal states', async () => {
    const dynos = [
      {name: 'web.1', state: 'down'} as Dyno,
      {name: 'web.1', state: 'starting'} as Dyno,
      {name: 'web.1', state: 'up'} as Dyno,
    ]
    const info = vi.fn()
      .mockResolvedValueOnce(dynos[0])
      .mockResolvedValueOnce(dynos[1])
      .mockResolvedValueOnce(dynos[2])
    const onPoll = vi.fn()

    await waitForInfo(ctxWithInfo(info), 'app-1', 'web.1', {
      delayMs: 1,
      onPoll,
      states: ['up'],
    })

    expect(onPoll).toHaveBeenCalledTimes(3)
    expect(onPoll.mock.calls.map(([d]) => d.state)).toEqual(['down', 'starting', 'up'])
  })

  it('does not call onPoll for 404 attempts', async () => {
    const dyno = {name: 'web.1', state: 'starting'} as Dyno
    const info = vi.fn()
      .mockRejectedValueOnce(buildNotFound())
      .mockResolvedValueOnce(dyno)
    const onPoll = vi.fn()

    await waitForInfo(ctxWithInfo(info), 'app-1', 'web.1', {delayMs: 1, onPoll})

    expect(onPoll).toHaveBeenCalledExactlyOnceWith(dyno)
  })

  it('propagates exceptions thrown from onPoll (no implicit catch)', async () => {
    const dyno = {name: 'web.1', state: 'up'} as Dyno
    const info = vi.fn().mockResolvedValueOnce(dyno)
    const consumerError = new Error('listener bug')

    await expect(waitForInfo(ctxWithInfo(info), 'app-1', 'web.1', {
      delayMs: 1,
      onPoll() {
        throw consumerError
      },
    })).rejects.toBe(consumerError)
    expect(info).toHaveBeenCalledTimes(1)
  })

  it('throws if the abort signal is already aborted', async () => {
    const info = vi.fn()
    const controller = new AbortController()
    controller.abort()

    await expect(waitForInfo(ctxWithInfo(info), 'app-1', 'web.1', {signal: controller.signal})).rejects.toThrow()
    expect(info).not.toHaveBeenCalled()
  })

  it('passes the signal to dyno.info via withOptions', async () => {
    const dyno = {name: 'web.1', state: 'up'} as Dyno
    const info = vi.fn().mockResolvedValueOnce(dyno)
    const ctx = ctxWithInfo(info)
    const controller = new AbortController()

    await waitForInfo(ctx, 'app-1', 'web.1', {delayMs: 1, signal: controller.signal})

    // @ts-expect-error — withOptions is on the mocked platform but not in the public type.
    expect(ctx.platform.withOptions).toHaveBeenCalledWith({signal: controller.signal})
  })

  it('aborts mid-backoff with no further info attempts', async () => {
    vi.useFakeTimers()
    try {
      const info = vi.fn().mockRejectedValue(buildNotFound())
      const controller = new AbortController()

      const promise = waitForInfo(ctxWithInfo(info), 'app-1', 'web.1', {
        attempts: 10,
        delayMs: 1000,
        signal: controller.signal,
      })
      // Drain microtasks: first info call fires, rejects, scheduler queues wait().
      await vi.advanceTimersByTimeAsync(0)
      expect(info).toHaveBeenCalledTimes(1)

      // Abort during the backoff window before the timer expires.
      controller.abort()
      await expect(promise).rejects.toThrow()
      expect(info).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('throws immediately when attempts is 0', async () => {
    const info = vi.fn()

    await expect(waitForInfo(ctxWithInfo(info), 'app-1', 'web.1', {attempts: 0, delayMs: 1})).rejects.toThrow(/was not available within 0 attempts/)
    expect(info).not.toHaveBeenCalled()
  })
})
