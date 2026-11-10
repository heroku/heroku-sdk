import type {ResourceCtx} from '../../../core/extend-resource.js'
import type {ResolvedPgDatabase} from './resolve-pg-database.js'

import {AdvancedDatabaseNotSupportedError} from '../database-settings/errors.js'
import {EssentialDatabaseNotSupportedError, isAdvancedDatabase, isEssentialTier} from './postgres-utils.js'
import {resolvePgDatabase} from './resolve-pg-database.js'

/**
 * Resolves the database whose settings are being read or changed. Only classic
 * tiers (Standard, Premium, Private, Shield) are supported: Essential-tier
 * databases have no configurable settings, and Advanced-tier databases use
 * `data.postgresSettings`.
 */
export async function resolveSettingsDatabase(
  ctx: Pick<ResourceCtx, 'platform'>,
  appIdentity: string,
  databaseIdentity: string | undefined,
  signal: AbortSignal | undefined,
): Promise<ResolvedPgDatabase> {
  const addon = await resolvePgDatabase(ctx, appIdentity, {input: databaseIdentity, signal})
  if (isEssentialTier(addon)) {
    throw new EssentialDatabaseNotSupportedError(addon, `Database settings aren't supported on Essential-tier databases. ${addon.name} is an Essential-tier database.`)
  }

  if (isAdvancedDatabase(addon)) throw new AdvancedDatabaseNotSupportedError(addon)

  return addon
}
