import {
  afterEach, describe, expect, it, vi,
} from 'vitest'

import {requestWithTimeout, waitForDuration} from './request-with-timeout.js'

describe('requestWithTimeout', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns the request result and passes a request-local signal', async () => {
    const request = vi.fn(async (signal: AbortSignal) => signal.aborted)
    const timeoutValue = Symbol('timeout')

    await expect(requestWithTimeout(request, {timeoutValue})).resolves.toBe(false)
    expect(request).toHaveBeenCalledOnce()
    expect(request.mock.calls[0]?.[0]).toBeInstanceOf(AbortSignal)
  })

  it('aborts only the request-local signal on timeout and handles late rejection', async () => {
    vi.useFakeTimers()
    let requestSignal: AbortSignal | undefined
    let rejectLate: ((error: Error) => void) | undefined
    const request = vi.fn((signal: AbortSignal) => {
      requestSignal = signal
      return new Promise<never>((_resolve, reject) => {
        rejectLate = reject
      })
    })
    const caller = new AbortController()
    const timeoutValue = Symbol('timeout')
    const pending = requestWithTimeout(request, {signal: caller.signal, timeoutMs: 10, timeoutValue})

    await vi.advanceTimersByTimeAsync(10)

    await expect(pending).resolves.toBe(timeoutValue)
    expect(requestSignal?.aborted).toBe(true)
    expect(caller.signal.aborted).toBe(false)
    expect(vi.getTimerCount()).toBe(0)

    rejectLate?.(new Error('late rejection'))
    await Promise.resolve()
  })

  it('propagates caller abort reason and aborts the request-local signal', async () => {
    vi.useFakeTimers()
    const caller = new AbortController()
    const reason = new Error('cancelled by caller')
    let requestSignal: AbortSignal | undefined
    const request = vi.fn((signal: AbortSignal) => {
      requestSignal = signal
      return new Promise<never>((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), {once: true})
      })
    })
    const pending = requestWithTimeout(request, {signal: caller.signal, timeoutValue: 'timeout'})

    await Promise.resolve()
    caller.abort(reason)

    await expect(pending).rejects.toBe(reason)
    expect(requestSignal?.aborted).toBe(true)
    expect(requestSignal?.reason).toBe(reason)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('does not invoke the request when the caller aborts before its callback runs', async () => {
    const caller = new AbortController()
    const reason = new Error('cancelled before request')
    const request = vi.fn(async (_signal: AbortSignal) => 'response')
    const pending = requestWithTimeout(request, {signal: caller.signal, timeoutValue: 'timeout'})

    caller.abort(reason)

    await expect(pending).rejects.toBe(reason)
    expect(request).not.toHaveBeenCalled()
  })

  it('prefers caller abort reason when request synchronously rejects on abort', async () => {
    const caller = new AbortController()
    const callerReason = new Error('cancelled by caller')
    const requestError = new Error('request rejected on abort')
    const request = vi.fn((signal: AbortSignal) => {
      const promise = new Promise<never>((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(requestError), {once: true})
      })
      caller.abort(callerReason)
      return promise
    })
    const pending = requestWithTimeout(request, {signal: caller.signal, timeoutValue: 'timeout'})

    await expect(pending).rejects.toBe(callerReason)
    expect(request).toHaveBeenCalledOnce()
  })

  it('supports timeout durations longer than the maximum timer delay', async () => {
    vi.useFakeTimers()
    const caller = new AbortController()
    const reason = new Error('cleanup')
    const request = vi.fn((_signal: AbortSignal) => new Promise<never>(() => {}))
    const pending = requestWithTimeout(request, {
      signal: caller.signal,
      timeoutMs: 2_147_484_647,
      timeoutValue: 'timeout',
    })

    await vi.advanceTimersByTimeAsync(1)
    expect(request).toHaveBeenCalledOnce()

    caller.abort(reason)
    await expect(pending).rejects.toBe(reason)
    expect(vi.getTimerCount()).toBe(0)
  })
})

describe('waitForDuration', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('preserves delays longer than the maximum timer delay', async () => {
    vi.useFakeTimers()
    const controller = new AbortController()
    const pending = waitForDuration(2_147_484_647, controller.signal)

    await vi.advanceTimersByTimeAsync(1)
    expect(vi.getTimerCount()).toBe(1)

    controller.abort(new Error('stop'))
    await expect(pending).rejects.toThrow('stop')
    expect(vi.getTimerCount()).toBe(0)
  })
})
