import type {ResourceCtx} from '../../../core/extend-resource.js'
import type {ResolvedPgDatabase} from '../internal/resolve-pg-database.js'
import type {DatabaseSettings, DatabaseSettingsOptions} from './index.js'

import {withSignal} from '../../../core/with-signal.js'
import {resolveSettingsDatabase} from '../internal/resolve-settings-database.js'

export type GetAllDatabaseSettingsResult = {
  addon: ResolvedPgDatabase
  settings: DatabaseSettings
}

/**
 * Returns every configurable setting on a classic-tier Postgres database, with
 * each setting's current value, default, and description.
 *
 * `databaseIdentity` selects the database (an attachment name, config var,
 * `app::attachment`, or add-on name). It defaults to `DATABASE_URL`.
 *
 * Throws `EssentialDatabaseNotSupportedError` for Essential-tier databases and
 * `AdvancedDatabaseNotSupportedError` for Advanced-tier databases (use
 * `data.postgresSettings`). Both carry the resolved add-on.
 */
export async function getAll(
  ctx: Pick<ResourceCtx, 'data' | 'platform'>,
  appIdentity: string,
  databaseIdentity?: string,
  options: DatabaseSettingsOptions = {},
): Promise<GetAllDatabaseSettingsResult> {
  const {signal} = options
  signal?.throwIfAborted()
  const addon = await resolveSettingsDatabase(ctx, appIdentity, databaseIdentity, signal)
  // Bind the signal so the request aborts in flight, not just during resolution.
  const data = withSignal(ctx.data, signal)
  const settings = await data.postgresDatabase.config(addon.id)

  return {addon, settings}
}
