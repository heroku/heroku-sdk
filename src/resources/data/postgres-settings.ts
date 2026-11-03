import type {
  PostgresSettingsInfoResult, PostgresSettingsUpdateOpts, PostgresSettingsUpdateResult,
} from '@heroku/types/data'

import type {ResourceCtx} from '../../core/extend-resource.js'
import type {ResolvedAddOn} from '../platform/add-on/types.js'

import {extendResource} from '../../core/extend-resource.js'
import {withSignal} from '../../core/with-signal.js'
import {resolveAddonInternal} from '../platform/add-on/resolve.js'
import {getPostgresServiceName, isAdvancedDatabase, NotAdvancedDatabaseError} from './internal/postgres-utils.js'

export type PostgresSettingsOptions = {
  appIdentity?: string
  signal?: AbortSignal
}

export type GetPostgresSettingsResult = {
  addon: ResolvedAddOn
  settings: PostgresSettingsInfoResult
}

export type UpdatePostgresSettingsResult = {
  addon: ResolvedAddOn
  settings: PostgresSettingsUpdateResult
}

async function resolveTieredAddon(
  ctx: Pick<ResourceCtx, 'platform'>,
  addonIdentity: string,
  options: PostgresSettingsOptions,
): Promise<ResolvedAddOn> {
  const {appIdentity, signal} = options
  signal?.throwIfAborted()
  // Bind the signal so the resolve request aborts in flight.
  const platform = withSignal(ctx.platform, signal)
  const addon = await resolveAddonInternal(platform, addonIdentity, {
    addonService: getPostgresServiceName(), appIdentity,
  })

  if (!isAdvancedDatabase(addon)) {
    throw new NotAdvancedDatabaseError(addon, `You can only manage settings on Advanced-tier databases. ${addon.name} isn't an Advanced-tier database.`)
  }

  return addon
}

/**
 * Reads the settings of an Advanced-tier Postgres database.
 *
 * Throws `NotAdvancedDatabaseError` (carrying the resolved addon) if
 * `addonIdentity` doesn't resolve to an Advanced-tier database.
 */
export async function info(
  ctx: Pick<ResourceCtx, 'data' | 'platform'>,
  addonIdentity: string,
  options: PostgresSettingsOptions = {},
): Promise<GetPostgresSettingsResult> {
  const addon = await resolveTieredAddon(ctx, addonIdentity, options)
  // Bind the signal so the info request aborts in flight.
  const data = withSignal(ctx.data, options.signal)
  const settings = await data.postgresSettings.info(addon.id)

  return {addon, settings}
}

/**
 * Updates the settings of an Advanced-tier Postgres database.
 *
 * Throws `NotAdvancedDatabaseError` (carrying the resolved addon) if
 * `addonIdentity` doesn't resolve to an Advanced-tier database.
 */
export async function update(
  ctx: Pick<ResourceCtx, 'data' | 'platform'>,
  addonIdentity: string,
  body: PostgresSettingsUpdateOpts,
  options: PostgresSettingsOptions = {},
): Promise<UpdatePostgresSettingsResult> {
  const addon = await resolveTieredAddon(ctx, addonIdentity, options)
  // Bind the signal so the update request aborts in flight.
  const data = withSignal(ctx.data, options.signal)
  const settings = await data.postgresSettings.update(addon.id, body)

  return {addon, settings}
}

export const postgresSettingsExtensions = extendResource('data', 'postgresSettings', ctx => ({
  info: (
    addonIdentity: string,
    options?: PostgresSettingsOptions,
  ) => info(ctx, addonIdentity, options),
  update: (
    addonIdentity: string,
    body: PostgresSettingsUpdateOpts,
    options?: PostgresSettingsOptions,
  ) => update(ctx, addonIdentity, body, options),
}))
