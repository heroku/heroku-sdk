/* eslint-disable camelcase */
import type {VpnConnection} from '@heroku/types/3.sdk'

import {
  afterEach, describe, expect, it, vi,
} from 'vitest'

import type {ResourceCtx} from '../../../core/extend-resource.js'

import {VpnConnectionFailedError, VpnConnectionNotReadyError, waitForActive} from './wait-for-active.js'

// Used to avoid timeouts in tests
const WAIT_INTERVAL_MS = 5

type FakePlatform = {
  vpnConnection: {
    info: ReturnType<typeof vi.fn>
  }
  withOptions: ReturnType<typeof vi.fn>
}

function buildCtx(stubs: {
  info?: ReturnType<typeof vi.fn>
} = {}): ResourceCtx {
  const platform: FakePlatform = {
    vpnConnection: {
      info: stubs.info ?? vi.fn().mockResolvedValue({}),
    },
    withOptions: vi.fn(function (this: any) {
      return this
    }),
  }
  platform.withOptions.mockReturnValue(platform)

  return {
    data: {} as never,
    metrics: {} as never,
    platform: platform as never,
    repositories: {} as never,
  }
}

function buildVpnConnection(overrides: Partial<VpnConnection> = {}): VpnConnection {
  return {
    id: 'vpn-1',
    ike_version: 2,
    name: 'my-vpn',
    public_ip: '127.0.0.1',
    routable_cidrs: ['127.0.0.1/32'],
    space_cidr_block: '127.0.0.1/32',
    status: 'active',
    status_message: 'this is a status message',
    tunnels: [{}],
    ...overrides,
  }
}

describe('waitForActive', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('waits for the VPN connection to become active', async () => {
    const pending = buildVpnConnection({status: 'pending'})
    const active = buildVpnConnection({status: 'active'})
    const ctx = buildCtx({
      info: vi.fn()
        .mockResolvedValueOnce(pending)
        .mockResolvedValueOnce(pending)
        .mockResolvedValueOnce(active),
    })

    const result = await waitForActive(ctx, 'space-1', 'my-vpn', {intervalMs: WAIT_INTERVAL_MS})

    expect(result).toEqual(active)
    expect(ctx.platform.vpnConnection.info).toHaveBeenCalledTimes(3)
  })

  it('returns immediately when the VPN connection is already active', async () => {
    const active = buildVpnConnection({status: 'active'})
    const ctx = buildCtx({
      info: vi.fn().mockResolvedValue(active),
    })

    const result = await waitForActive(ctx, 'space-1', 'my-vpn', {intervalMs: WAIT_INTERVAL_MS})

    expect(result).toEqual(active)
    expect(ctx.platform.vpnConnection.info).toHaveBeenCalledTimes(1)
  })

  it('throws an error when the VPN connection fails', async () => {
    const failed = buildVpnConnection({status: 'failed'})
    const ctx = buildCtx({
      info: vi.fn().mockResolvedValue(failed),
    })

    try {
      await waitForActive(ctx, 'space-1', 'my-vpn', {intervalMs: WAIT_INTERVAL_MS})
      expect.fail('Expected VpnConnectionFailedError to be thrown')
    } catch (error) {
      expect(error).toBeInstanceOf(VpnConnectionFailedError)

      const e = error as VpnConnectionFailedError

      expect(e.vpnConnection).toEqual(failed)
      expect(e.message).toEqual(failed.status_message)
      expect(ctx.platform.vpnConnection.info).toHaveBeenCalledTimes(1)
    }
  })

  it('respects timeout', async () => {
    const pending = buildVpnConnection({status: 'pending'})
    const ctx = buildCtx({
      info: vi.fn().mockResolvedValue(pending),
    })

    try {
      await waitForActive(ctx, 'space-1', 'my-vpn', {
        intervalMs: WAIT_INTERVAL_MS,
        timeoutMs: WAIT_INTERVAL_MS * 2,
      })
      expect.fail('Expected VpnConnectionNotReadyError to be thrown')
    } catch (error) {
      expect(error).toBeInstanceOf(VpnConnectionNotReadyError)

      const e = error as VpnConnectionNotReadyError

      expect(e.vpnConnection).toEqual(pending)
      expect(e.message).toEqual('Timeout waiting for VPN to become allocated.')
      // depending on the speed of the test, we may have more calls, but we should have at least 2
      // call 1: before loop starts
      // call 2: first loop iteration
      expect(vi.mocked(ctx.platform.vpnConnection.info).mock.calls.length).toBeGreaterThanOrEqual(2)
    }
  })

  it('rejects when the signal is already aborted, without polling', async () => {
    const active = buildVpnConnection({status: 'active'})
    const ctx = buildCtx({
      info: vi.fn().mockResolvedValue(active),
    })
    const controller = new AbortController()
    controller.abort()

    await expect(waitForActive(ctx, 'space-1', 'my-vpn', {
      intervalMs: WAIT_INTERVAL_MS,
      signal: controller.signal,
    })).rejects.toThrow()
    expect(ctx.platform.vpnConnection.info).not.toHaveBeenCalled()
  })

  it('rejects when the signal aborts mid-wait', async () => {
    const controller = new AbortController()
    let callCount = 0

    const pending = buildVpnConnection({status: 'pending'})
    const ctx = buildCtx({
      info: vi.fn().mockImplementation(() => {
        callCount++
        if (callCount === 2) {
          controller.abort()
        }

        return Promise.resolve(pending)
      }),
    })

    await expect(waitForActive(ctx, 'space-1', 'my-vpn', {
      intervalMs: WAIT_INTERVAL_MS,
      signal: controller.signal,
    })).rejects.toThrow()

    expect(ctx.platform.vpnConnection.info).toHaveBeenCalledTimes(2)
  })

  it('calls poller.onStart once before waiting and onStop once after becoming active', async () => {
    const calls: string[] = []

    const pending = buildVpnConnection({status: 'pending'})
    const active = buildVpnConnection({status: 'active'})
    const ctx = buildCtx({
      info: vi.fn()
        .mockResolvedValueOnce(pending)
        .mockImplementationOnce(async (_appIdentity: string, _vpnConnectionId: string) => {
          calls.push('info')
          return active
        }),
    })

    const onStart = vi.fn(() => calls.push('onStart'))
    const onStop = vi.fn(() => calls.push('onStop'))

    const result = await waitForActive(ctx, 'space-1', 'my-vpn', {
      intervalMs: WAIT_INTERVAL_MS,
      poller: {onStart, onStop},
    })

    expect(calls).toEqual([
      'onStart',
      'info',
      'onStop',
    ])
    expect(onStart).toHaveBeenCalledTimes(1)
    expect(onStop).toHaveBeenCalledTimes(1)
    expect(result).toEqual(active)
  })
})
