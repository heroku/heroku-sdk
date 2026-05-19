import type {MaintenanceInfoResult} from '@heroku/types/data'

import type {ResourceCtx} from '../../core/extend-resource.js'

import {extendResource} from '../../core/extend-resource.js'
import {resolveAddonId} from './internal/resolve-addon-id.js'

export type MaintenanceInfoOptions = {
  signal?: AbortSignal
}

export async function info(
  ctx: Pick<ResourceCtx, 'data' | 'platform'>,
  appIdentity: string,
  addonIdentity?: string,
  options: MaintenanceInfoOptions = {},
): Promise<MaintenanceInfoResult> {
  options.signal?.throwIfAborted()
  const addonId = await resolveAddonId(ctx.platform, appIdentity, addonIdentity)
  return ctx.data.maintenance.info(addonId)
}

export const maintenanceExtensions = extendResource('data', 'maintenance', ctx => ({
  info: (
    appIdentity: string,
    addonIdentity?: string,
    options?: MaintenanceInfoOptions,
  ) => info(ctx, appIdentity, addonIdentity, options),
}))
