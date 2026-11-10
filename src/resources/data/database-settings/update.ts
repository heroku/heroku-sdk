import type {PostgresDatabaseUpdateConfigOpts} from '@heroku/types/data'

import type {ResourceCtx} from '../../../core/extend-resource.js'
import type {GetDatabaseSettingResult} from './get.js'
import type {DatabaseSetting, DatabaseSettingKey, DatabaseSettingsOptions} from './index.js'

import {withSignal} from '../../../core/with-signal.js'
import {UnknownSettingError} from './errors.js'
import {resolveSettingsDatabase} from './resolve.js'

export type UpdateDatabaseSettingResult<K extends DatabaseSettingKey = DatabaseSettingKey> = GetDatabaseSettingResult<K>

/**
 * Sets one setting on a Postgres database and returns the updated setting.
 *
 * Throws `EssentialDatabaseNotSupportedError` for Essential-tier databases, and
 * `UnknownSettingError` when the updated settings don't include `key`.
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
  if (!setting) throw new UnknownSettingError(addon, key)

  return {addon, setting: setting as DatabaseSetting<K>}
}
