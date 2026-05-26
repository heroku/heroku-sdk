import type {TransferScheduleListResult} from '@heroku/types/data'

import type {ResourceCtx} from '../../core/extend-resource.js'

import {extendResource} from '../../core/extend-resource.js'
import {resolvePgDatabase} from './internal/resolve-pg-database.js'

export type TransferScheduleOptions = {
  signal?: AbortSignal
}

export async function list(
  ctx: Pick<ResourceCtx, 'data' | 'platform'>,
  appIdentity: string,
  addonIdentity?: string,
  options: TransferScheduleOptions = {},
): Promise<TransferScheduleListResult> {
  options.signal?.throwIfAborted()
  const addon = await resolvePgDatabase(ctx, {appIdentity, input: addonIdentity, ...options})
  return ctx.data.transferSchedule.list(addon.id)
}

export const transferScheduleExtensions = extendResource('data', 'transferSchedule', ctx => ({
  list: (appIdentity: string, addonIdentity?: string, options?: TransferScheduleOptions) =>
    list(ctx, appIdentity, addonIdentity, options),
}))
