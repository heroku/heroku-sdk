import type {PostgresDatabaseListCredentialsResult} from '@heroku/types/data'

import type {ResourceCtx} from '../../core/extend-resource.js'

import {extendResource} from '../../core/extend-resource.js'
import {resolveAddonId} from './internal/resolve-addon-id.js'

export type ListCredentialsOptions = {
  signal?: AbortSignal
}

export async function listCredentials(
  ctx: Pick<ResourceCtx, 'data' | 'platform'>,
  appIdentity: string,
  addonIdentity?: string,
  options: ListCredentialsOptions = {},
): Promise<PostgresDatabaseListCredentialsResult> {
  options.signal?.throwIfAborted()
  const addonId = await resolveAddonId(ctx.platform, appIdentity, addonIdentity)
  return ctx.data.postgresDatabase.listCredentials(addonId)
}

export const postgresDatabaseExtensions = extendResource('data', 'postgresDatabase', ctx => ({
  listCredentials: (
    appIdentity: string,
    addonIdentity?: string,
    options?: ListCredentialsOptions,
  ) => listCredentials(ctx, appIdentity, addonIdentity, options),
}))
