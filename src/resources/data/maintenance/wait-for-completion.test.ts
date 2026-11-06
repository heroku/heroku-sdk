import {
  afterEach, describe, expect, it, vi,
} from 'vitest'

import type {ResourceCtx} from '../../../core/extend-resource.js'

import {waitForCompletion} from './wait-for-completion.js'

// Used to avoid timeouts in tests
const WAIT_INTERVAL_MS = 5

function buildAddon() {
  return {
    // eslint-disable-next-line camelcase
    addon_service: {name: 'heroku-postgresql'},
    app: {id: 'app-uuid', name: 'app-1'},
    id: 'addon-1',
    name: 'pg-addon',
    plan: {name: 'heroku-postgresql:standard-0'},
  }
}

function buildCtx(opts: {
  maintenanceInfo?: ReturnType<typeof vi.fn>
  resolution?: ReturnType<typeof vi.fn>
}): Pick<ResourceCtx, 'data' | 'platform'> {
  const dataClient = {
    maintenance: {
      info: opts.maintenanceInfo ?? vi.fn(),
    },
    withOptions: vi.fn(() => dataClient),
  }

  return {
    data: dataClient as never,
    platform: {
      addOn: {
        resolution: opts.resolution ?? vi.fn().mockResolvedValue([buildAddon()]),
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

describe('waitForCompletion', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('throws if maintenance is not already running on the first poll', async () => {
    const resolution = vi.fn().mockResolvedValue([buildAddon()])
    const maintenanceInfo = vi.fn().mockResolvedValue({status: 'completed'})
    const ctx = buildCtx({maintenanceInfo, resolution})

    await expect(waitForCompletion(ctx, 'postgres-curved-12345'))
      .rejects.toThrow('There currently isn\'t any maintenance in progress for pg-addon')

    expect(resolution).toHaveBeenCalledTimes(1)
    expect(maintenanceInfo).toHaveBeenCalledExactlyOnceWith('addon-1')
  })

  it('polls until status leaves running, resolving the addon exactly once', async () => {
    const resolution = vi.fn().mockResolvedValue([buildAddon()])
    const maintenanceInfo = vi.fn()
      .mockResolvedValueOnce({status: 'running'})
      .mockResolvedValueOnce({status: 'running'})
      .mockResolvedValueOnce({status: 'completed'})
    const ctx = buildCtx({maintenanceInfo, resolution})

    const result = await waitForCompletion(ctx, 'postgres-curved-12345', {intervalMs: WAIT_INTERVAL_MS})

    expect(maintenanceInfo).toHaveBeenCalledTimes(3)
    expect(resolution).toHaveBeenCalledTimes(1)
    expect(result).toEqual({status: 'completed'})
  })

  it('scopes resolution by appIdentity when given', async () => {
    const resolution = vi.fn().mockResolvedValue([buildAddon()])
    const maintenanceInfo = vi.fn()
      .mockResolvedValueOnce({status: 'running'})
      .mockResolvedValueOnce({status: 'completed'})
    const ctx = buildCtx({maintenanceInfo, resolution})

    const result = await waitForCompletion(ctx, 'DATABASE_URL', {appIdentity: 'app-1', intervalMs: WAIT_INTERVAL_MS})

    expect(resolution).toHaveBeenCalledWith({addon: 'DATABASE_URL', app: 'app-1'})
    expect(result).toEqual({status: 'completed'})
  })

  it('throws when timeoutMs elapses before completion', async () => {
    vi.useFakeTimers()

    const maintenanceInfo = vi.fn().mockResolvedValue({status: 'running'})
    const ctx = buildCtx({maintenanceInfo})

    const promise = waitForCompletion(ctx, 'postgres-curved-12345', {intervalMs: WAIT_INTERVAL_MS, timeoutMs: 250})
    const expectation = expect(promise).rejects.toThrow('did not complete within 250ms')
    await vi.advanceTimersByTimeAsync(1000)
    await expectation
  })

  it('fires beforeWait with the resolved addon before the first wait poll', async () => {
    const calls: string[] = []
    const resolution = vi.fn().mockResolvedValue([buildAddon()])
    const maintenanceInfo = vi.fn()
      .mockImplementationOnce(() => {
        calls.push('info - initial call')
        return {status: 'running'}
      })
      .mockImplementationOnce(() => {
        calls.push('info - wait poll')
        return {status: 'completed'}
      })
    const ctx = buildCtx({maintenanceInfo, resolution})
    const beforeWait = vi.fn(() => {
      calls.push('beforeWait')
    })

    const result = await waitForCompletion(ctx, 'postgres-curved-12345', {beforeWait, intervalMs: WAIT_INTERVAL_MS})

    expect(beforeWait).toHaveBeenCalledWith({addon: buildAddon()})
    expect(calls).toEqual([
      'info - initial call',
      'beforeWait',
      'info - wait poll',
    ])
    expect(result).toEqual({status: 'completed'})
  })

  it('throws before polling when beforeWait throws', async () => {
    const maintenanceInfo = vi.fn().mockResolvedValue({status: 'running'})
    const ctx = buildCtx({maintenanceInfo})
    const beforeWait = vi.fn().mockRejectedValue(new Error('declined'))

    await expect(waitForCompletion(ctx, 'postgres-curved-12345', {beforeWait})).rejects.toThrow('declined')
    expect(maintenanceInfo).toHaveBeenCalledTimes(1) // initial call only
  })

  it('throws after beforeWait if the signal is aborted', async () => {
    const maintenanceInfo = vi.fn().mockResolvedValue({status: 'running'})
    const controller = new AbortController()
    const ctx = buildCtx({maintenanceInfo})
    const beforeWait = vi.fn(() => controller.abort())

    await expect(waitForCompletion(ctx, 'postgres-curved-12345', {beforeWait, signal: controller.signal})).rejects.toThrow()
    expect(maintenanceInfo).toHaveBeenCalledTimes(1) // initial call only
  })

  it('throws immediately if the abort signal is already aborted', async () => {
    const maintenanceInfo = vi.fn()
    const ctx = buildCtx({maintenanceInfo})
    const controller = new AbortController()
    controller.abort()

    await expect(waitForCompletion(ctx, 'postgres-curved-12345', {signal: controller.signal})).rejects.toThrow()
    expect(maintenanceInfo).not.toHaveBeenCalled()
  })

  it('aborts the poll delay when the signal fires mid-poll', async () => {
    vi.useFakeTimers()

    const maintenanceInfo = vi.fn().mockResolvedValue({status: 'running'})
    const ctx = buildCtx({maintenanceInfo})
    const controller = new AbortController()

    const promise = waitForCompletion(ctx, 'postgres-curved-12345', {
      intervalMs: 5000, signal: controller.signal,
    })
    const expectation = expect(promise).rejects.toThrow(/aborted/i)
    await vi.advanceTimersByTimeAsync(0)
    controller.abort()
    await vi.advanceTimersByTimeAsync(0)
    await expectation
  })
})
