import type {PostgresCredentialInfoResult, PostgresCredentialListResult} from '@heroku/types/data'

import type {ResourceCtx} from '../../core/extend-resource.js'

import {extendResource} from '../../core/extend-resource.js'
import {resolvePgDatabase} from './internal/resolve-pg-database.js'

export type PostgresCredentialOptions = {
  signal?: AbortSignal
}

export async function list(
  ctx: Pick<ResourceCtx, 'data' | 'platform'>,
  appIdentity: string,
  addonIdentity?: string,
  options: PostgresCredentialOptions = {},
): Promise<PostgresCredentialListResult> {
  options.signal?.throwIfAborted()
  const addon = await resolvePgDatabase(ctx, {appIdentity, input: addonIdentity, ...options})
  return ctx.data.postgresCredential.list(addon.id)
}

export async function info(
  ctx: Pick<ResourceCtx, 'data' | 'platform'>,
  appIdentity: string,
  credName: string,
  addonIdentity?: string,
  options: PostgresCredentialOptions = {},
): Promise<PostgresCredentialInfoResult> {
  options.signal?.throwIfAborted()
  const addon = await resolvePgDatabase(ctx, {appIdentity, input: addonIdentity, ...options})
  return ctx.data.postgresCredential.info(addon.id, credName)
}

export const postgresCredentialExtensions = extendResource('data', 'postgresCredential', ctx => ({
  info: (appIdentity: string, credName: string, addonIdentity?: string, options?: PostgresCredentialOptions) =>
    info(ctx, appIdentity, credName, addonIdentity, options),
  list: (appIdentity: string, addonIdentity?: string, options?: PostgresCredentialOptions) =>
    list(ctx, appIdentity, addonIdentity, options),
}))
