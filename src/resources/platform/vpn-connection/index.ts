import {extendResource} from '../../../core/extend-resource.js'
import {waitForActive, type WaitForActiveOptions} from './wait-for-active.js'

export {
  VpnConnectionFailedError, VpnConnectionNotReadyError, waitForActive, type WaitForActiveOptions,
} from './wait-for-active.js'

export type VpnConnectionOptions = {
  signal?: AbortSignal
}

export const vpnConnectionExtensions = extendResource('platform', 'vpnConnection', ctx => ({
  waitForActive: (
    spaceIdentity: string,
    vpnConnectionIdentity: string,
    options?: WaitForActiveOptions,
  ) => waitForActive(ctx, spaceIdentity, vpnConnectionIdentity, options),
}))
