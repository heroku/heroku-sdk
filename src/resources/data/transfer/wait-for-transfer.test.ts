/* eslint-disable camelcase */
import {
  afterEach, describe, expect, it, vi,
} from 'vitest'

import type {ResourceCtx} from '../../../core/extend-resource.js'

import {legacyResourceCtx} from '../../../../test-types/heroku-sdk-options.js'
import {mergeExtensions} from '../../../core/extensions-proxy.js'
import {
  transferExtensions, TransferFailedError, TransferTimeoutError, waitForTransfer,
} from './wait-for-transfer.js'

const DEFAULT_INTERVAL_MS = 3

function buildCtx(opts: {
  infoByApp?: ReturnType<typeof vi.fn>
  onSignal?: (signal?: AbortSignal) => void
  operationSignal?: AbortSignal
}): ResourceCtx {
  let requestSignal: AbortSignal | undefined = opts.operationSignal
  const callInfoByApp = opts.infoByApp ?? vi.fn()
  const dataClient = {
    transfer: {
      infoByApp: new Proxy(callInfoByApp, {
        apply(target, thisArg, args: unknown[]) {
          return Reflect.apply(target, thisArg, [...args, ...(opts.onSignal && requestSignal ? [requestSignal] : [])])
        },
      }),
    },
    withOptions(options?: {signal?: AbortSignal}) {
      if (options?.signal !== undefined) requestSignal = options.signal
      opts.onSignal?.(requestSignal)
      return dataClient
    },
  }
  return {
    ...legacyResourceCtx,
    data: dataClient as never,
    operationSignal: opts.operationSignal,
  }
}

function buildSdkDataClient(ctx: ResourceCtx) {
  const makeRoutes = (): Record<string, unknown> => ({
    transfer: {},
    withOptions: vi.fn().mockImplementation(makeRoutes),
  })

  return mergeExtensions(makeRoutes(), [transferExtensions], ctx) as {
    transfer: {waitForTransfer: typeof waitForTransfer}
    withOptions: (options: {signal?: AbortSignal}) => ReturnType<typeof buildSdkDataClient>
  }
}

describe('waitForTransfer', () => {
  afterEach(() => {
    vi.clearAllMocks()
    vi.useRealTimers()
  })

  it('returns immediately when the transfer is already finished and succeeded', async () => {
    const infoByAppMock = vi.fn().mockResolvedValue({finished_at: '2024-01-01 00:00:00 UTC', succeeded: true, uuid: 'xfer-1'})
    const ctx = buildCtx({infoByApp: infoByAppMock})

    const result = await waitForTransfer(ctx, 'app-1', 'xfer-1')

    expect(infoByAppMock).toHaveBeenCalledExactlyOnceWith('app-1', 'xfer-1', {verbose: undefined})
    expect(result).toEqual({finished_at: '2024-01-01 00:00:00 UTC', succeeded: true, uuid: 'xfer-1'})
  })

  it('polls until the transfer finishes', async () => {
    const infoByAppMock = vi.fn()
      .mockResolvedValueOnce({finished_at: undefined, succeeded: false, uuid: 'xfer-1'})
      .mockResolvedValueOnce({finished_at: undefined, succeeded: false, uuid: 'xfer-1'})
      .mockResolvedValueOnce({finished_at: '2024-01-01 00:00:00 UTC', succeeded: true, uuid: 'xfer-1'})
    const ctx = buildCtx({infoByApp: infoByAppMock})

    const result = await waitForTransfer(ctx, 'app-1', 'xfer-1', {intervalMs: DEFAULT_INTERVAL_MS})

    expect(infoByAppMock).toHaveBeenCalledTimes(3)
    expect(result).toEqual({finished_at: '2024-01-01 00:00:00 UTC', succeeded: true, uuid: 'xfer-1'})
  })

  it('invokes onPoll on every poll', async () => {
    const infoByAppMock = vi.fn()
      .mockResolvedValueOnce({finished_at: undefined, succeeded: false, uuid: 'xfer-1'})
      .mockResolvedValueOnce({finished_at: '2024-01-01 00:00:00 UTC', succeeded: true, uuid: 'xfer-1'})
    const ctx = buildCtx({infoByApp: infoByAppMock})
    const onPoll = vi.fn()

    await waitForTransfer(ctx, 'app-1', 'xfer-1', {intervalMs: DEFAULT_INTERVAL_MS, onPoll})

    expect(onPoll).toHaveBeenCalledTimes(2)
    expect(onPoll).toHaveBeenNthCalledWith(1, {finished_at: undefined, succeeded: false, uuid: 'xfer-1'})
    expect(onPoll).toHaveBeenNthCalledWith(2, {finished_at: '2024-01-01 00:00:00 UTC', succeeded: true, uuid: 'xfer-1'})
  })

  it('throws TransferFailedError when the transfer finishes unsuccessfully, re-fetching verbosely', async () => {
    const infoByAppMock = vi.fn()
      .mockResolvedValueOnce({finished_at: '2024-01-01 00:00:00 UTC', succeeded: false, uuid: 'xfer-1'})
      .mockResolvedValueOnce({
        finished_at: '2024-01-01 00:00:00 UTC', log_lines: ['boom'], succeeded: false, uuid: 'xfer-1',
      })
    const ctx = buildCtx({infoByApp: infoByAppMock})

    await expect(waitForTransfer(ctx, 'app-1', 'xfer-1')).rejects.toThrow(TransferFailedError)
    expect(infoByAppMock).toHaveBeenCalledTimes(2)
    expect(infoByAppMock).toHaveBeenNthCalledWith(2, 'app-1', 'xfer-1', {verbose: true})
  })

  it('does not re-fetch when already verbose on failure', async () => {
    const infoByAppMock = vi.fn().mockResolvedValue({
      finished_at: '2024-01-01 00:00:00 UTC', log_lines: ['boom'], succeeded: false, uuid: 'xfer-1',
    })
    const ctx = buildCtx({infoByApp: infoByAppMock})

    await expect(waitForTransfer(ctx, 'app-1', 'xfer-1', {verbose: true})).rejects.toThrow(TransferFailedError)
    expect(infoByAppMock).toHaveBeenCalledTimes(1)
  })

  it('throws TransferTimeoutError when timeoutMs elapses before the transfer finishes', async () => {
    const infoByAppMock = vi.fn().mockResolvedValue({finished_at: undefined, succeeded: false, uuid: 'xfer-1'})
    const ctx = buildCtx({infoByApp: infoByAppMock})

    await expect(waitForTransfer(ctx, 'app-1', 'xfer-1', {intervalMs: DEFAULT_INTERVAL_MS, timeoutMs: 10})).rejects.toBeInstanceOf(TransferTimeoutError)
  })

  it('times out a pending poll and preserves timeout identity without attaching the transfer', async () => {
    vi.useFakeTimers()
    const callerController = new AbortController()
    let rejectPoll: ((reason: Error) => void) | undefined
    let pollSignal: AbortSignal | undefined
    const infoByAppMock = vi.fn()
      .mockResolvedValueOnce({finished_at: undefined, succeeded: false, uuid: 'xfer-1'})
      .mockImplementation(() => new Promise((_, reject) => {
        rejectPoll = reject
      }))
    const ctx = buildCtx({
      infoByApp: infoByAppMock,
      onSignal(signal) {
        pollSignal = signal
      },
    })
    const pending = waitForTransfer(ctx, 'app-1', 'xfer-1', {
      intervalMs: DEFAULT_INTERVAL_MS,
      signal: callerController.signal,
      timeoutMs: 10,
    })
      .then(value => ({value}), error_ => ({error_}))

    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(DEFAULT_INTERVAL_MS)
    await vi.advanceTimersByTimeAsync(10 - DEFAULT_INTERVAL_MS)

    const settled = await pending
    const {error_} = settled
    const error = error_
    expect(error).toBeInstanceOf(TransferTimeoutError)
    expect(error).toMatchObject({
      timeoutMs: 10,
      transferId: 'xfer-1',
    })
    expect(error).not.toHaveProperty('transfer')
    expect(infoByAppMock).toHaveBeenCalledTimes(2)
    expect(pollSignal?.aborted).toBe(true)
    expect(pollSignal).not.toBe(callerController.signal)
    expect(callerController.signal.aborted).toBe(false)

    rejectPoll?.(new Error('late poll rejection'))
    await Promise.resolve()
  })

  it('aborts a pending poll when the caller signal aborts', async () => {
    const controller = new AbortController()
    const abortReason = new Error('caller cancelled')
    let markRequestStarted!: () => void
    const requestStarted = new Promise<void>(resolve => {
      markRequestStarted = resolve
    })
    let pollSignal: AbortSignal | undefined
    const infoByAppMock = vi.fn().mockImplementation(() => new Promise((_, reject) => {
      markRequestStarted()
      pollSignal?.addEventListener('abort', () => reject(abortReason), {once: true})
    }))
    const ctx = buildCtx({
      infoByApp: infoByAppMock,
      onSignal(signal) {
        pollSignal = signal
      },
    })
    const pending = waitForTransfer(ctx, 'app-1', 'xfer-1', {signal: controller.signal, timeoutMs: 1000})
      .then(value => ({value}), error_ => ({error_}))

    await requestStarted
    controller.abort(abortReason)

    const settled = await pending
    const {error_} = settled
    expect(error_).toBe(abortReason)
    expect(pollSignal?.aborted).toBe(true)
    expect(infoByAppMock).toHaveBeenCalledOnce()
  })

  it('preserves a configured client signal when a timed poll is in flight', async () => {
    // Model the derived routes client returned by sdk.data.withOptions({signal}).
    const clientController = new AbortController()
    const callerController = new AbortController()
    const abortReason = new Error('client cancelled')
    let markRequestStarted!: () => void
    const requestStarted = new Promise<void>(resolve => {
      markRequestStarted = resolve
    })
    let requestSignal: AbortSignal | undefined
    const infoByAppMock = vi.fn((_app: string, _transfer: string, _options: unknown, signal?: AbortSignal) =>
      new Promise((_, reject) => {
        markRequestStarted()
        signal?.addEventListener('abort', () => reject(signal.reason), {once: true})
      }))
    const ctx = buildCtx({
      infoByApp: infoByAppMock,
      onSignal(signal) {
        requestSignal = signal
      },
    })
    const pending = buildSdkDataClient(ctx).withOptions({signal: clientController.signal})
      .transfer.waitForTransfer('app-1', 'xfer-1', {signal: callerController.signal, timeoutMs: 1000})
      .then(value => ({value}), error_ => ({error_}))

    await requestStarted
    const effectiveSignal = infoByAppMock.mock.calls[0]?.[3]
    expect(effectiveSignal).toBeInstanceOf(AbortSignal)
    expect(effectiveSignal).not.toBe(clientController.signal)

    clientController.abort(abortReason)

    const settled = await pending
    const {error_} = settled
    expect(error_).toBe(abortReason)
    expect((effectiveSignal as AbortSignal).aborted).toBe(true)
    expect(requestSignal).toBe(effectiveSignal)
    expect(callerController.signal.aborted).toBe(false)
    expect(infoByAppMock).toHaveBeenCalledOnce()
  })

  it('does not clamp a timeout longer than the maximum timer delay', async () => {
    vi.useFakeTimers()
    const controller = new AbortController()
    const abortReason = new Error('test cleanup')
    let requestSignal: AbortSignal | undefined
    const infoByAppMock = vi.fn((_app: string, _transfer: string, _options: unknown, signal?: AbortSignal) =>
      new Promise((_, reject) => {
        signal?.addEventListener('abort', () => reject(signal.reason), {once: true})
      }))
    const ctx = buildCtx({
      infoByApp: infoByAppMock,
      onSignal(signal) {
        requestSignal = signal
      },
    })
    const pending = waitForTransfer(ctx, 'app-1', 'xfer-1', {
      signal: controller.signal,
      timeoutMs: 2_147_484_647,
    }).then(value => ({value}), error_ => ({error_}))

    await vi.advanceTimersByTimeAsync(1)

    expect(requestSignal?.aborted).toBe(false)
    expect(infoByAppMock).toHaveBeenCalledOnce()

    controller.abort(abortReason)
    const settled = await pending
    const {error_} = settled
    expect(error_).toBe(abortReason)
  })

  it('does not clamp a polling interval longer than the maximum timer delay', async () => {
    vi.useFakeTimers()
    const controller = new AbortController()
    const abortReason = new Error('test cleanup')
    const infoByAppMock = vi.fn().mockResolvedValue({finished_at: undefined, succeeded: false, uuid: 'xfer-1'})
    const ctx = buildCtx({infoByApp: infoByAppMock})
    const pending = waitForTransfer(ctx, 'app-1', 'xfer-1', {
      intervalMs: 2_147_484_647,
      signal: controller.signal,
    }).then(value => ({value}), error_ => ({error_}))

    await vi.advanceTimersByTimeAsync(1)

    expect(infoByAppMock).toHaveBeenCalledOnce()

    controller.abort(abortReason)
    const settled = await pending
    const {error_} = settled
    expect(error_).toBe(abortReason)
  })

  it('tolerates a transient failure and recovers on the next poll', async () => {
    const infoByAppMock = vi.fn()
      .mockRejectedValueOnce(new Error('ECONNRESET'))
      .mockResolvedValueOnce({finished_at: '2024-01-01 00:00:00 UTC', succeeded: true, uuid: 'xfer-1'})
    const ctx = buildCtx({infoByApp: infoByAppMock})

    const result = await waitForTransfer(ctx, 'app-1', 'xfer-1', {intervalMs: DEFAULT_INTERVAL_MS})

    expect(infoByAppMock).toHaveBeenCalledTimes(2)
    expect(result).toEqual({finished_at: '2024-01-01 00:00:00 UTC', succeeded: true, uuid: 'xfer-1'})
  })

  it('rethrows once the failure count exceeds the maximum', async () => {
    const error = new Error('ECONNRESET')
    const infoByAppMock = vi.fn().mockRejectedValue(error)
    const ctx = buildCtx({infoByApp: infoByAppMock})

    await expect(waitForTransfer(ctx, 'app-1', 'xfer-1', {intervalMs: DEFAULT_INTERVAL_MS})).rejects.toBe(error)
    expect(infoByAppMock).toHaveBeenCalledTimes(21)
  })

  it('stops immediately on an AbortError instead of counting it as a retryable failure', async () => {
    const abortError = Object.assign(new Error('aborted'), {name: 'AbortError'})
    const infoByAppMock = vi.fn().mockRejectedValue(abortError)
    const ctx = buildCtx({infoByApp: infoByAppMock})

    await expect(waitForTransfer(ctx, 'app-1', 'xfer-1', {intervalMs: DEFAULT_INTERVAL_MS})).rejects.toBe(abortError)
    expect(infoByAppMock).toHaveBeenCalledOnce()
  })

  it('stops immediately once the signal has aborted, whatever the poll error', async () => {
    const controller = new AbortController()
    const error = new Error('socket hang up')
    const abortReason = new Error('caller cancelled')
    let markRequestStarted!: () => void
    const requestStarted = new Promise<void>(resolve => {
      markRequestStarted = resolve
    })
    // The request fails and the signal aborts in the same tick (e.g. a
    // client-level cancellation): the abort must win over the retry counter.
    const infoByAppMock = vi.fn().mockImplementation(() => {
      markRequestStarted()
      controller.abort(abortReason)
      return Promise.reject(error)
    })
    const ctx = buildCtx({infoByApp: infoByAppMock})

    const pending = waitForTransfer(ctx, 'app-1', 'xfer-1', {intervalMs: DEFAULT_INTERVAL_MS, signal: controller.signal})
    const expectation = expect(pending).rejects.toBe(abortReason)
    await requestStarted
    await expectation
    expect(infoByAppMock).toHaveBeenCalledOnce()
  })
})
