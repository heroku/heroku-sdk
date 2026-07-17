/* eslint-disable camelcase */
import {
  afterEach, describe, expect, it, vi,
} from 'vitest'

import {buildCtx, buildDomain} from '../domain/test-utils.js'
import {waitForACMCertificates} from './wait-for-acm-certificates.js'

afterEach(() => {
  vi.useRealTimers()
})

describe('waitForACMCertificates', () => {
  it('returns immediately when all custom domains already have cert issued', async () => {
    const domain = buildDomain({acm_status: 'cert issued'})
    const list = vi.fn().mockResolvedValueOnce([domain])
    const ctx = buildCtx({domainList: list})

    const result = await waitForACMCertificates(ctx, 'my-app', {intervalMs: 1})

    expect(list).toHaveBeenCalledExactlyOnceWith('my-app')
    expect(result).toEqual([domain])
  })

  it('returns only custom domains, ignoring heroku domains', async () => {
    const custom = buildDomain({acm_status: 'cert issued', id: 'custom-1', kind: 'custom'})
    const heroku = buildDomain({acm_status: null, id: 'heroku-1', kind: 'heroku'})
    const list = vi.fn().mockResolvedValueOnce([heroku, custom])
    const ctx = buildCtx({domainList: list})

    const result = await waitForACMCertificates(ctx, 'my-app', {intervalMs: 1})

    expect(list).toHaveBeenCalledTimes(1)
    expect(result).toEqual([custom])
    expect(result.every(domain => domain.kind === 'custom')).toBe(true)
  })

  it('does not let a non-terminal heroku domain block termination', async () => {
    // heroku domain has acm_status null (non-terminal) but must be ignored.
    const custom = buildDomain({acm_status: 'cert issued', id: 'custom-1', kind: 'custom'})
    const heroku = buildDomain({acm_status: null, id: 'heroku-1', kind: 'heroku'})
    const list = vi.fn().mockResolvedValueOnce([heroku, custom])
    const ctx = buildCtx({domainList: list})

    const result = await waitForACMCertificates(ctx, 'my-app', {intervalMs: 1})

    expect(list).toHaveBeenCalledTimes(1)
    expect(result).toEqual([custom])
  })

  it('returns [] when there are no custom domains', async () => {
    const heroku = buildDomain({acm_status: null, id: 'heroku-1', kind: 'heroku'})
    const list = vi.fn().mockResolvedValueOnce([heroku])
    const ctx = buildCtx({domainList: list})

    const result = await waitForACMCertificates(ctx, 'my-app', {intervalMs: 1})

    expect(list).toHaveBeenCalledTimes(1)
    expect(result).toEqual([])
  })

  it('returns [] when the domain list is empty', async () => {
    const list = vi.fn().mockResolvedValueOnce([])
    const ctx = buildCtx({domainList: list})

    const result = await waitForACMCertificates(ctx, 'my-app', {intervalMs: 1})

    expect(list).toHaveBeenCalledTimes(1)
    expect(result).toEqual([])
  })

  it('polls until all custom domains reach a terminal status', async () => {
    vi.useFakeTimers()
    const pending = buildDomain({acm_status: 'pending'})
    const issued = buildDomain({acm_status: 'cert issued'})
    const list = vi.fn()
      .mockResolvedValueOnce([pending])
      .mockResolvedValueOnce([pending])
      .mockResolvedValueOnce([issued])
    const ctx = buildCtx({domainList: list})

    const promise = waitForACMCertificates(ctx, 'my-app')

    // Drain the initial list() call.
    await vi.advanceTimersByTimeAsync(0)
    expect(list).toHaveBeenCalledTimes(1)

    // Default base interval is 15s; advance through two backoff waits.
    await vi.advanceTimersByTimeAsync(15_000)
    expect(list).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(15_000)

    const result = await promise
    expect(list).toHaveBeenCalledTimes(3)
    expect(result).toEqual([issued])
  })

  it('throws when a custom domain finishes with acm_status failed', async () => {
    const list = vi.fn().mockResolvedValueOnce([buildDomain({acm_status: 'failed'})])
    const ctx = buildCtx({domainList: list})

    await expect(waitForACMCertificates(ctx, 'my-app', {intervalMs: 1})).rejects.toThrow('ACM not enabled for some domains')
  })

  it('treats a mix of cert issued + failed as terminal, then throws', async () => {
    const list = vi.fn().mockResolvedValueOnce([
      buildDomain({acm_status: 'cert issued', hostname: 'a.example.com', id: 'd1'}),
      buildDomain({acm_status: 'failed', hostname: 'b.example.com', id: 'd2'}),
    ])
    const ctx = buildCtx({domainList: list})

    await expect(waitForACMCertificates(ctx, 'my-app', {intervalMs: 1})).rejects.toThrow('ACM not enabled for some domains')
    // Terminal on the first list — no further polling.
    expect(list).toHaveBeenCalledTimes(1)
  })

  it('throws immediately if the abort signal is already aborted', async () => {
    const list = vi.fn()
    const ctx = buildCtx({domainList: list})
    const controller = new AbortController()
    controller.abort()

    await expect(waitForACMCertificates(ctx, 'my-app', {signal: controller.signal})).rejects.toThrow()
    expect(list).not.toHaveBeenCalled()
  })

  it('passes the signal to domain.list via withOptions', async () => {
    const list = vi.fn().mockResolvedValueOnce([buildDomain({acm_status: 'cert issued'})])
    const ctx = buildCtx({domainList: list})
    const controller = new AbortController()

    await waitForACMCertificates(ctx, 'my-app', {intervalMs: 1, signal: controller.signal})

    // @ts-expect-error — withOptions is on the mocked platform but not in the public type.
    expect(ctx.platform.withOptions).toHaveBeenCalledWith({signal: controller.signal})
  })

  it('throws a timeout error when domains never become terminal', async () => {
    vi.useFakeTimers()
    const list = vi.fn().mockResolvedValue([buildDomain({acm_status: 'pending'})])
    const ctx = buildCtx({domainList: list})

    const promise = waitForACMCertificates(ctx, 'my-app', {
      intervalMs: 15_000,
      timeoutMs: 10_000,
    })
    // Surface the rejection to the microtask queue so it isn't unhandled.
    const settled = promise.then(
      () => ({ok: true as const}),
      (error: unknown) => ({error, ok: false as const}),
    )

    // First list() resolves, loop schedules a 15s backoff wait; after it
    // fires the deadline (10s) has passed and it throws.
    await vi.advanceTimersByTimeAsync(15_000)

    const outcome = await settled
    expect(outcome.ok).toBe(false)
    if (!outcome.ok) {
      expect((outcome.error as Error).message).toBe('Timed out waiting for ACM certificates on app my-app')
    }
  })
})
