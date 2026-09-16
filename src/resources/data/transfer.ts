import type {TransferListByAppResult} from '@heroku/types/data'

import type {ResourceCtx} from '../../core/extend-resource.js'

import {extendResource} from '../../core/extend-resource.js'
import {resolvePgDatabase} from './internal/resolve-pg-database.js'

export type TransferOptions = {
  signal?: AbortSignal
}

export async function listByApp(
  ctx: Pick<ResourceCtx, 'data' | 'platform'>,
  appIdentity: string,
  addonIdentity?: string,
  options: TransferOptions = {},
): Promise<TransferListByAppResult> {
  options.signal?.throwIfAborted()
  let addon
  try {
    addon = await resolvePgDatabase(ctx, {appIdentity, input: addonIdentity, ...options})
  } catch (error: unknown) {
    if (error instanceof Error && 'statusCode' in error && (error as {statusCode: number}).statusCode === 404) {
      return []
    }

    throw error
  }

  return ctx.data.transfer.listByApp(addon.id)
}

export const transferExtensions = extendResource('data', 'transfer', ctx => ({
  listByApp: (appIdentity: string, addonIdentity?: string, options?: TransferOptions) =>
    listByApp(ctx, appIdentity, addonIdentity, options),
}))
