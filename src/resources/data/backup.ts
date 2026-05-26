import type {BackupCreateResult} from '@heroku/types/data'

import type {ResourceCtx} from '../../core/extend-resource.js'

import {extendResource} from '../../core/extend-resource.js'
import {resolvePgDatabase} from './internal/resolve-pg-database.js'

export type BackupOptions = {
  signal?: AbortSignal
}

export async function create(
  ctx: Pick<ResourceCtx, 'data' | 'platform'>,
  appIdentity: string,
  addonIdentity?: string,
  options: BackupOptions = {},
): Promise<BackupCreateResult> {
  options.signal?.throwIfAborted()
  const addon = await resolvePgDatabase(ctx, {appIdentity, input: addonIdentity, ...options})
  return ctx.data.backup.create(addon.id)
}

export const backupExtensions = extendResource('data', 'backup', ctx => ({
  create: (appIdentity: string, addonIdentity?: string, options?: BackupOptions) =>
    create(ctx, appIdentity, addonIdentity, options),
}))
