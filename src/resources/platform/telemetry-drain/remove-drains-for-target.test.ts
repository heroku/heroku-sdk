/* eslint-disable camelcase */
import type {TelemetryDrain} from '@heroku/types/3.sdk'

import {
  describe, expect, it, vi,
} from 'vitest'

import type {ResourceCtx} from '../../../core/extend-resource.js'

import {removeDrainsForTarget} from './index.js'

type FakePlatform = {
  telemetryDrain: {
    delete: ReturnType<typeof vi.fn>
    listByApp: ReturnType<typeof vi.fn>
    listBySpace: ReturnType<typeof vi.fn>
  }
  withOptions: ReturnType<typeof vi.fn>
}

function buildCtx(stubs: {
  telemetryDrainDelete?: ReturnType<typeof vi.fn>
  telemetryDrainListByApp?: ReturnType<typeof vi.fn>
  telemetryDrainListBySpace?: ReturnType<typeof vi.fn>
} = {}): ResourceCtx {
  const platform: FakePlatform = {
    telemetryDrain: {
      delete: stubs.telemetryDrainDelete ?? vi.fn().mockResolvedValue({}),
      listByApp: stubs.telemetryDrainListByApp ?? vi.fn().mockResolvedValue([]),
      listBySpace: stubs.telemetryDrainListBySpace ?? vi.fn().mockResolvedValue([]),
    },
    withOptions: vi.fn(function (this: any) {
      return this
    }),
  }
  platform.withOptions.mockReturnValue(platform)

  return {
    data: {} as never,
    platform: platform as never,
  }
}

function buildTelemetryDrain(overrides: Partial<TelemetryDrain> = {}): TelemetryDrain {
  return {
    created_at: '2024-01-01T00:00:00Z',
    exporter: {
      endpoint: 'https://example.com/telemetry',
      headers: {},
      type: 'otlphttp',
    },
    id: 'drain-id',
    owner: {id: 'owner-id', type: 'app'},
    signals: ['metrics'],
    updated_at: '2024-01-01T00:00:00Z',
    ...overrides,
  }
}

describe('removeDrainsForTarget', () => {
  it('removes all drains for an app', async () => {
    const drain1 = buildTelemetryDrain({id: 'drain-1'})
    const drain2 = buildTelemetryDrain({id: 'drain-2'})
    const ctx = buildCtx({
      telemetryDrainDelete: vi.fn()
        .mockResolvedValueOnce(drain1)
        .mockResolvedValueOnce(drain2),
      telemetryDrainListByApp: vi.fn().mockResolvedValue([drain1, drain2]),
    })

    const result = await removeDrainsForTarget(ctx, {app: 'my-app'})

    const {delete: deleteFn, listByApp} = ctx.platform.telemetryDrain
    expect(listByApp).toHaveBeenCalledExactlyOnceWith('my-app')
    expect(deleteFn).toHaveBeenCalledTimes(2)
    expect(deleteFn).toHaveBeenNthCalledWith(1, 'drain-1')
    expect(deleteFn).toHaveBeenNthCalledWith(2, 'drain-2')
    expect(result).toEqual([drain1, drain2])
  })

  it('removes all drains for a space', async () => {
    const drain1 = buildTelemetryDrain({id: 'drain-1'})
    const drain2 = buildTelemetryDrain({id: 'drain-2'})
    const ctx = buildCtx({
      telemetryDrainDelete: vi.fn()
        .mockResolvedValueOnce(drain1)
        .mockResolvedValueOnce(drain2),
      telemetryDrainListBySpace: vi.fn().mockResolvedValue([drain1, drain2]),
    })

    const result = await removeDrainsForTarget(ctx, {space: 'my-space'})

    const {delete: deleteFn, listBySpace} = ctx.platform.telemetryDrain
    expect(listBySpace).toHaveBeenCalledExactlyOnceWith('my-space')
    expect(deleteFn).toHaveBeenCalledTimes(2)
    expect(deleteFn).toHaveBeenNthCalledWith(1, 'drain-1')
    expect(deleteFn).toHaveBeenNthCalledWith(2, 'drain-2')
    expect(result).toEqual([drain1, drain2])
  })

  it('returns an empty array when no drains exist for an app', async () => {
    const ctx = buildCtx({
      telemetryDrainListByApp: vi.fn().mockResolvedValue([]),
    })

    const result = await removeDrainsForTarget(ctx, {app: 'my-app'})

    const {delete: deleteFn, listByApp} = ctx.platform.telemetryDrain
    expect(listByApp).toHaveBeenCalledExactlyOnceWith('my-app')
    expect(deleteFn).not.toHaveBeenCalled()
    expect(result).toEqual([])
  })

  it('returns an empty array when no drains exist for a space', async () => {
    const ctx = buildCtx({
      telemetryDrainListBySpace: vi.fn().mockResolvedValue([]),
    })

    const result = await removeDrainsForTarget(ctx, {space: 'my-space'})

    const {delete: deleteFn, listBySpace} = ctx.platform.telemetryDrain
    expect(listBySpace).toHaveBeenCalledExactlyOnceWith('my-space')
    expect(deleteFn).not.toHaveBeenCalled()
    expect(result).toEqual([])
  })

  it('throws if the abort signal is already aborted', async () => {
    const ctx = buildCtx()
    const controller = new AbortController()
    controller.abort()

    await expect(removeDrainsForTarget(
      ctx,
      {app: 'my-app'},
      {signal: controller.signal},
    )).rejects.toThrow()
    expect(ctx.platform.telemetryDrain.listByApp).not.toHaveBeenCalled()
  })

  it('rejects when any delete fails', async () => {
    const drain1 = buildTelemetryDrain({id: 'drain-1'})
    const drain2 = buildTelemetryDrain({id: 'drain-2'})
    const error = new Error('delete failed')
    const ctx = buildCtx({
      telemetryDrainDelete: vi.fn()
        .mockResolvedValueOnce(drain1)
        .mockRejectedValueOnce(error),
      telemetryDrainListByApp: vi.fn().mockResolvedValue([drain1, drain2]),
    })
    const {delete: deleteFn} = ctx.platform.telemetryDrain
    await expect(removeDrainsForTarget(ctx, {app: 'my-app'})).rejects.toBe(error)
    expect(deleteFn).toHaveBeenCalledTimes(2)
    expect(deleteFn).toHaveBeenNthCalledWith(1, 'drain-1')
    expect(deleteFn).toHaveBeenNthCalledWith(2, 'drain-2')
  })
})
