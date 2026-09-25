/* eslint-disable camelcase */
import {
  afterEach, describe, expect, it, vi,
} from 'vitest'

import type {ResourceCtx} from '../../core/extend-resource.js'

import {legacyResourceCtx} from '../../../test-types/heroku-sdk-options.js'
import {TransferFailedError, TransferTimeoutError, waitForTransfer} from './wait-for-transfer.js'

const DEFAULT_INTERVAL_MS = 3

function buildCtx(opts: {
  infoByApp?: ReturnType<typeof vi.fn>
}): ResourceCtx {
  const dataClient = {
    transfer: {
      infoByApp: opts.infoByApp ?? vi.fn(),
    },
    withOptions() {
      return dataClient
    },
  }
  return {
    ...legacyResourceCtx,
    data: dataClient as never,
  }
}

describe('waitForTransfer', () => {
  afterEach(() => {
    vi.clearAllMocks()
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

    await expect(waitForTransfer(ctx, 'app-1', 'xfer-1', {intervalMs: DEFAULT_INTERVAL_MS, timeoutMs: 10})).rejects.toThrow(TransferTimeoutError)
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
})
