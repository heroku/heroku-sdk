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

  // The Data API rejects every /postgres/v0/databases/* request for an
  // Advanced-tier add-on (422 not_allowed_on_advanced; see
  // LegacyApiProxyMiddleware#lookup_by_postgres_addon in heroku/data-api), and
  // classifies plans the same way isAdvancedDatabase does. Failing here skips
  // that request and lets callers point users to the Advanced-tier settings API.
  if (isAdvancedDatabase(addon)) throw new AdvancedDatabaseNotSupportedError(addon)

  return addon
}
