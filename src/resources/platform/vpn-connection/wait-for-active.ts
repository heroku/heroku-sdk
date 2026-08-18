/* eslint-disable no-await-in-loop */
import type {VpnConnection} from '@heroku/types/3.sdk'

import type {ResourceCtx} from '../../../core/extend-resource.js'
import type {Poller} from '../../../utils/poller.js'
import type {VpnConnectionOptions} from './index.js'

import {wait} from '../../../utils/wait.js'

const DEFAULT_INTERVAL_MS = 10 * 1000
const DEFAULT_TIMEOUT_MS = 20 * 60 * 1000

export class VpnConnectionFailedError extends Error {
  public readonly id = 'vpn_connection_failed'

  constructor(public readonly vpnConnection: VpnConnection) {
    super(vpnConnection.status_message)
    this.name = 'VpnConnectionFailedError'
  }
}

export class VpnConnectionNotReadyError extends Error {
  public readonly id = 'vpn_connection_not_ready'

  constructor(
    public readonly vpnConnection: VpnConnection,
    public readonly timeoutMs: number,
  ) {
    super('Timeout waiting for VPN to become allocated.')
    this.name = 'VpnConnectionNotReadyError'
  }
}

export type WaitForActiveOptions = VpnConnectionOptions & {
  /**
   * Delay between polls in milliseconds.
   * Defaults to 10000 (10s)
   */
  intervalMs?: number
  /**
   * Fires `poller.onStart` immediately before polling begins
   * and `poller.onStop` once the connection becomes active.
   */
  poller?: Poller<VpnConnection>
  /**
   * Wall-clock budget in milliseconds before {@link VpnConnectionNotReadyError}
   * is thrown. Defaults to 1200000 (20 minutes)
   */
  timeoutMs?: number
}

/**
 * Poll `vpnConnection.info` until the connection's `status` is `active`,
 * then return it.
 *
 * If `status` becomes `failed`, throws {@link VpnConnectionFailedError}.
 * On exceeding `timeoutMs` without reaching `active` or `failed`, throws
 * {@link VpnConnectionNotReadyError}.
 */
export async function waitForActive(
  ctx: Pick<ResourceCtx, 'platform'>,
  spaceIdentity: string,
  vpnConnectionIdentity: string,
  options: WaitForActiveOptions = {},
): Promise<VpnConnection> {
  const {
    intervalMs = DEFAULT_INTERVAL_MS,
    poller,
    signal,
    timeoutMs = DEFAULT_TIMEOUT_MS,
  } = options

  signal?.throwIfAborted()

  const platform = signal ? ctx.platform.withOptions({signal}) : ctx.platform

  const deadline = Date.now() + timeoutMs

  let vpnConnection = await platform.vpnConnection.info(spaceIdentity, vpnConnectionIdentity)

  poller?.onStart?.(vpnConnection)

  while (vpnConnection.status !== 'active') {
    signal?.throwIfAborted()

    if (vpnConnection.status === 'failed') {
      throw new VpnConnectionFailedError(vpnConnection)
    }

    if (Date.now() >= deadline) {
      throw new VpnConnectionNotReadyError(vpnConnection, timeoutMs)
    }

    await wait(intervalMs, signal)
    vpnConnection = await platform.vpnConnection.info(spaceIdentity, vpnConnectionIdentity)
  }

  poller?.onStop?.(vpnConnection)
  return vpnConnection
}
