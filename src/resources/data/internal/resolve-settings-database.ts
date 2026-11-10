import type {ResourceCtx} from '../../../core/extend-resource.js'
import type {ResolvedPgDatabase} from './resolve-pg-database.js'

import {EssentialDatabaseNotSupportedError, isEssentialTier} from './postgres-utils.js'
import {resolvePgDatabase} from './resolve-pg-database.js'

/**
 * Resolves the database whose settings are being read or changed, rejecting
 * Essential-tier databases, which don't support configurable settings.
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

  return addon
}
