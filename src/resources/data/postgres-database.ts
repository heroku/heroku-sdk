import type {ResourceCtx} from '../../core/extend-resource.js'

import {extendResource} from '../../core/extend-resource.js'
import {resolvePgDatabase} from './internal/resolve-pg-database.js'

export type ListCredentialsOptions = {
  signal?: AbortSignal
}

// The OpenAPI spec declares no fixed response schema for listCredentials
// (@heroku/types' PostgresDatabaseListCredentialsResult is `Record<string, unknown>`),
// so we use a custom type here.
export type CredentialInfo = {
  credentials: Array<{
    connections?: null | number
    password: string
    state: string
    user: string
  }>
  database: string
  host: string
  name: string
  port: string
  state: string
  uuid: string
}

export async function listCredentials(
  ctx: Pick<ResourceCtx, 'data' | 'platform'>,
  appIdentity: string,
  addonIdentity?: string,
  options: ListCredentialsOptions = {},
): Promise<CredentialInfo[]> {
  options.signal?.throwIfAborted()
  const addon = await resolvePgDatabase(ctx, {appIdentity, input: addonIdentity, ...options})
  return ctx.data.postgresDatabase.listCredentials(addon.id) as unknown as Promise<CredentialInfo[]>
}

export const postgresDatabaseExtensions = extendResource('data', 'postgresDatabase', ctx => ({
  listCredentials: (
    appIdentity: string,
    addonIdentity?: string,
    options?: ListCredentialsOptions,
  ) => listCredentials(ctx, appIdentity, addonIdentity, options),
}))
