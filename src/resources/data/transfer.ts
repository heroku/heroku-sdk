import type {TransferInfoByAppResult, TransferListByAppResult} from '@heroku/types/data'

import type {ResourceCtx} from '../../core/extend-resource.js'

import {extendResource} from '../../core/extend-resource.js'

export type TransferOptions = {
  signal?: AbortSignal
}

export async function listByApp(
  ctx: Pick<ResourceCtx, 'data'>,
  appIdentity: string,
  options: TransferOptions = {},
): Promise<TransferListByAppResult> {
  options.signal?.throwIfAborted()
  return ctx.data.transfer.listByApp(appIdentity)
}

export async function infoByApp(
  ctx: Pick<ResourceCtx, 'data'>,
  appIdentity: string,
  xferId: string,
  options: TransferOptions = {},
): Promise<TransferInfoByAppResult> {
  options.signal?.throwIfAborted()
  return ctx.data.transfer.infoByApp(appIdentity, xferId)
}

export const transferExtensions = extendResource('data', 'transfer', ctx => ({
  infoByApp: (appIdentity: string, xferId: string, options?: TransferOptions) =>
    infoByApp(ctx, appIdentity, xferId, options),
  listByApp: (appIdentity: string, options?: TransferOptions) =>
    listByApp(ctx, appIdentity, options),
}))
