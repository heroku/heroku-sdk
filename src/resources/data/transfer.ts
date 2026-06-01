import type {ResourceCtx} from '../../core/extend-resource.js'

import {extendResource} from '../../core/extend-resource.js'
import {resolvePgDatabase} from './internal/resolve-pg-database.js'

export type TransferOptions = {
  signal?: AbortSignal
}

export type BackupTransfer = {
  canceled_at: string
  created_at: string
  deleted_at: string
  finished_at: string
  from_name: string
  from_type: string
  from_url: string
  logs: Array<{
    created_at: string
    level: string
    message: string
  }>
  num: number
  num_keep: number
  options: Record<string, unknown>
  processed_bytes: number
  purged_at: string
  schedule?: {uuid: string}
  source_bytes: number
  started_at: string
  succeeded: boolean
  to_name: string
  to_type: string
  to_url: string
  updated_at: string
  uuid: string
  warnings: number
}

type TransferDataClient = {
  transfer: {
    listByApp(name: string): Promise<BackupTransfer[]>
  }
}

type TransferCtx = {data: TransferDataClient; platform: ResourceCtx['platform']}

export async function listByApp(
  ctx: TransferCtx,
  appIdentity: string,
  addonIdentity?: string,
  options: TransferOptions = {},
): Promise<BackupTransfer[]> {
  options.signal?.throwIfAborted()
  const addon = await resolvePgDatabase(ctx, {appIdentity, input: addonIdentity, ...options})
  return ctx.data.transfer.listByApp(addon.id)
}

export const transferExtensions = extendResource('data', 'transfer', rawCtx => {
  // Bridge heroku-types' loose client types to the adapter's strongly-typed contract
  const ctx = rawCtx as unknown as TransferCtx
  return {
    listByApp: (appIdentity: string, addonIdentity?: string, options?: TransferOptions) =>
      listByApp(ctx, appIdentity, addonIdentity, options),
  }
})
