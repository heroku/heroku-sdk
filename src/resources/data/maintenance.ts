import type {MaintenanceInfoResult} from '@heroku/types/data'

import type {ResourceCtx} from '../../core/extend-resource.js'

import {extendResource} from '../../core/extend-resource.js'
import {resolvePgDatabase} from './internal/resolve-pg-database.js'

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
  const addon = await resolvePgDatabase(ctx, {appIdentity, input: addonIdentity, ...options})
  return ctx.data.maintenance.info(addon.id)
}

export const maintenanceExtensions = extendResource('data', 'maintenance', ctx => ({
  info: (
    appIdentity: string,
    addonIdentity?: string,
    options?: MaintenanceInfoOptions,
  ) => info(ctx, appIdentity, addonIdentity, options),
}))
