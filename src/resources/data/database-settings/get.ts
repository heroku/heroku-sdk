import type {ResourceCtx} from '../../../core/extend-resource.js'
import type {DatabaseSetting, DatabaseSettingKey, DatabaseSettingsOptions} from './index.js'

import {UnknownDatabaseSettingError} from './errors.js'
import {getAll, type GetAllDatabaseSettingsResult} from './get-all.js'

export type GetDatabaseSettingResult<K extends DatabaseSettingKey = DatabaseSettingKey> = {
  addon: GetAllDatabaseSettingsResult['addon']
  key: K
  setting: DatabaseSetting<K>
}

/**
 * Returns one setting on a classic-tier Postgres database.
 *
 * Throws `EssentialDatabaseNotSupportedError` for Essential-tier databases,
 * `AdvancedDatabaseNotSupportedError` for Advanced-tier databases (use
 * `data.postgresSettings`), and `UnknownDatabaseSettingError` when the
 * database's settings don't include `key`.
 */
export async function get<K extends DatabaseSettingKey>(
  ctx: Pick<ResourceCtx, 'data' | 'platform'>,
  appIdentity: string,
  key: K,
  databaseIdentity?: string,
  options: DatabaseSettingsOptions = {},
): Promise<GetDatabaseSettingResult<K>> {
  const {addon, settings} = await getAll(ctx, appIdentity, databaseIdentity, options)
  const setting = settings[key]
  if (setting === undefined) throw new UnknownDatabaseSettingError(addon, key)

  return {addon, key, setting: setting as DatabaseSetting<K>}
}
