import type {
  PostgresQuotaInfoResult, PostgresQuotaListResult, PostgresQuotaUpdateOpts, PostgresQuotaUpdateResult,
} from '@heroku/types/data'

import type {ResourceCtx} from '../../core/extend-resource.js'
import type {ResolvedAddOn} from '../platform/add-on/types.js'

import {extendResource} from '../../core/extend-resource.js'
import {withSignal} from '../../core/with-signal.js'
import {resolveAddonInternal} from '../platform/add-on/resolve.js'
import {getPostgresServiceName, isAdvancedDatabase, NotAdvancedDatabaseError} from './internal/postgres-utils.js'

export type PostgresQuotaOptions = {
  appIdentity?: string
  signal?: AbortSignal
}

export type ListPostgresQuotasResult = {
  addon: ResolvedAddOn
  quotas: PostgresQuotaListResult
}

export type GetPostgresQuotaResult = {
  addon: ResolvedAddOn
  quota: PostgresQuotaInfoResult
}

export type UpdatePostgresQuotaResult = {
  addon: ResolvedAddOn
  quota: PostgresQuotaUpdateResult
}

async function resolveTieredAddon(
  ctx: Pick<ResourceCtx, 'platform'>,
  addonIdentity: string,
  options: PostgresQuotaOptions,
): Promise<ResolvedAddOn> {
  const {appIdentity, signal} = options
  signal?.throwIfAborted()
  // Bind the signal so the resolve request aborts in flight.
  const platform = withSignal(ctx.platform, signal)
  const addon = await resolveAddonInternal(platform, addonIdentity, {
    addonService: getPostgresServiceName(), appIdentity,
  })

  if (!isAdvancedDatabase(addon)) {
    throw new NotAdvancedDatabaseError(addon, `You can only manage quotas on Advanced-tier databases. ${addon.name} isn't an Advanced-tier database.`)
  }

  return addon
}

/**
 * Lists quotas on an Advanced-tier Postgres database.
 *
 * Throws `NotAdvancedDatabaseError` (carrying the resolved addon) if
 * `addonIdentity` doesn't resolve to an Advanced-tier database.
 */
export async function list(
  ctx: Pick<ResourceCtx, 'data' | 'platform'>,
  addonIdentity: string,
  options: PostgresQuotaOptions = {},
): Promise<ListPostgresQuotasResult> {
  const addon = await resolveTieredAddon(ctx, addonIdentity, options)
  // Bind the signal so the list request aborts in flight.
  const data = withSignal(ctx.data, options.signal)
  const quotas = await data.postgresQuota.list(addon.id)

  return {addon, quotas}
}

/**
 * Looks up a single quota on an Advanced-tier Postgres database.
 *
 * Throws `NotAdvancedDatabaseError` (carrying the resolved addon) if
 * `addonIdentity` doesn't resolve to an Advanced-tier database.
 */
export async function info(
  ctx: Pick<ResourceCtx, 'data' | 'platform'>,
  addonIdentity: string,
  quotaType: string,
  options: PostgresQuotaOptions = {},
): Promise<GetPostgresQuotaResult> {
  const addon = await resolveTieredAddon(ctx, addonIdentity, options)
  // Bind the signal so the info request aborts in flight.
  const data = withSignal(ctx.data, options.signal)
  const quota = await data.postgresQuota.info(addon.id, quotaType)

  return {addon, quota}
}

/**
 * Updates a quota's settings on an Advanced-tier Postgres database.
 *
 * Throws `NotAdvancedDatabaseError` (carrying the resolved addon) if
 * `addonIdentity` doesn't resolve to an Advanced-tier database.
 */
export async function update(
  ctx: Pick<ResourceCtx, 'data' | 'platform'>,
  addonIdentity: string,
  quotaType: string,
  body: PostgresQuotaUpdateOpts,
  options: PostgresQuotaOptions = {},
): Promise<UpdatePostgresQuotaResult> {
  const addon = await resolveTieredAddon(ctx, addonIdentity, options)
  // Bind the signal so the update request aborts in flight.
  const data = withSignal(ctx.data, options.signal)
  const quota = await data.postgresQuota.update(addon.id, quotaType, body)

  return {addon, quota}
}

export const postgresQuotaExtensions = extendResource('data', 'postgresQuota', ctx => ({
  info: (
    addonIdentity: string,
    quotaType: string,
    options?: PostgresQuotaOptions,
  ) => info(ctx, addonIdentity, quotaType, options),
  list: (
    addonIdentity: string,
    options?: PostgresQuotaOptions,
  ) => list(ctx, addonIdentity, options),
  update: (
    addonIdentity: string,
    quotaType: string,
    body: PostgresQuotaUpdateOpts,
    options?: PostgresQuotaOptions,
  ) => update(ctx, addonIdentity, quotaType, body, options),
}))
