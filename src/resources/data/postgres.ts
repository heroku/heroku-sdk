import type {PostgresInfoResult} from '@heroku/types/data'

import type {ResourceCtx} from '../../core/extend-resource.js'

import {extendResource} from '../../core/extend-resource.js'
import {resolvePgDatabase} from './internal/resolve-pg-database.js'

export type PostgresOptions = {
  signal?: AbortSignal
}

export async function info(
  ctx: Pick<ResourceCtx, 'data' | 'platform'>,
  appIdentity: string,
  addonIdentity?: string,
  options: PostgresOptions = {},
): Promise<PostgresInfoResult> {
  options.signal?.throwIfAborted()
  const addon = await resolvePgDatabase(ctx, {appIdentity, input: addonIdentity, ...options})
  return ctx.data.postgres.info(addon.id)
}

export const postgresExtensions = extendResource('data', 'postgres', ctx => ({
  info: (appIdentity: string, addonIdentity?: string, options?: PostgresOptions) =>
    info(ctx, appIdentity, addonIdentity, options),
}))
