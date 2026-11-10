import type {PostgresDatabaseUpdateConfigOpts} from '@heroku/types/data'

import type {ResourceCtx} from '../../../core/extend-resource.js'
import type {GetDatabaseSettingResult} from './get.js'
import type {DatabaseSetting, DatabaseSettingKey, DatabaseSettingsOptions} from './index.js'

import {withSignal} from '../../../core/with-signal.js'
import {resolveSettingsDatabase} from '../internal/resolve-settings-database.js'
import {UnknownDatabaseSettingError} from './errors.js'

export type UpdateDatabaseSettingResult<K extends DatabaseSettingKey = DatabaseSettingKey> = GetDatabaseSettingResult<K>

/**
 * Sets one setting on a classic-tier Postgres database and returns the updated
 * setting.
 *
 * Throws `EssentialDatabaseNotSupportedError` for Essential-tier databases and
 * `AdvancedDatabaseNotSupportedError` for Advanced-tier databases (use
 * `data.postgresSettings`), before sending anything. Throws
 * `UnknownDatabaseSettingError` when the response doesn't include `key`; the
 * update was sent, so it may have been applied.
 */
export async function update<K extends DatabaseSettingKey>(
  ctx: Pick<ResourceCtx, 'data' | 'platform'>,
  appIdentity: string,
  key: K,
  value: DatabaseSetting<K>['value'],
  databaseIdentity?: string,
  options: DatabaseSettingsOptions = {},
): Promise<UpdateDatabaseSettingResult<K>> {
  const {signal} = options
  signal?.throwIfAborted()
  const addon = await resolveSettingsDatabase(ctx, appIdentity, databaseIdentity, signal)
  // Bind the signal so the request aborts in flight, not just during resolution.
  const data = withSignal(ctx.data, signal)
  // `PostgresDatabaseUpdateConfigOpts` only lists some of the keys the endpoint accepts.
  const body = {[key]: value} as PostgresDatabaseUpdateConfigOpts
  const settings = await data.postgresDatabase.updateConfig(addon.id, body)
  const setting = settings[key]
  if (setting === undefined) {
    throw new UnknownDatabaseSettingError(addon, key, `The update to ${key} was sent to ${addon.name}, but the response didn't include ${key}, so the change couldn't be confirmed.`)
  }

  return {addon, key, setting: setting as DatabaseSetting<K>}
}
