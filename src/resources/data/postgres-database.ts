import type {ResourceCtx} from '../../core/extend-resource.js'

import {extendResource} from '../../core/extend-resource.js'
import {resolvePgDatabase} from './internal/resolve-pg-database.js'

export type ListCredentialsOptions = {
  signal?: AbortSignal
}

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

type CredentialsDataClient = {
  postgresDatabase: {
    listCredentials(name: string): Promise<CredentialInfo[]>
  }
}

type CredentialsCtx = {data: CredentialsDataClient; platform: ResourceCtx['platform']}

export async function listCredentials(
  ctx: CredentialsCtx,
  appIdentity: string,
  addonIdentity?: string,
  options: ListCredentialsOptions = {},
): Promise<CredentialInfo[]> {
  options.signal?.throwIfAborted()
  const addon = await resolvePgDatabase(ctx, {appIdentity, input: addonIdentity, ...options})
  return ctx.data.postgresDatabase.listCredentials(addon.id)
}

export const postgresDatabaseExtensions = extendResource('data', 'postgresDatabase', rawCtx => {
  // Bridge heroku-types' loose client types to the adapter's strongly-typed contract
  const ctx = rawCtx as unknown as CredentialsCtx
  return {
    listCredentials: (
      appIdentity: string,
      addonIdentity?: string,
      options?: ListCredentialsOptions,
    ) => listCredentials(ctx, appIdentity, addonIdentity, options),
  }
})
