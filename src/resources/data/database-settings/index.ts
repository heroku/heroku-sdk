import type {PostgresDatabaseConfigResult} from '@heroku/types/data'

import {extendResource} from '../../../core/extend-resource.js'
import {getAll} from './get-all.js'
import {get} from './get.js'
import {update} from './update.js'

export type DatabaseSettingsOptions = {
  signal?: AbortSignal
}

/** Every configurable setting on a classic-tier Postgres database, keyed by setting name. */
export type DatabaseSettings = PostgresDatabaseConfigResult

export type DatabaseSettingKey = keyof DatabaseSettings

/** One setting: its current `value`, `default`, and `desc` (plus `values` for enum settings). */
export type DatabaseSetting<K extends DatabaseSettingKey = DatabaseSettingKey> = NonNullable<DatabaseSettings[K]>

export type {DatabaseSettingsAddon} from './addon.js'
export {AdvancedDatabaseNotSupportedError, UnknownDatabaseSettingError} from './errors.js'
export {getAll, type GetAllDatabaseSettingsResult} from './get-all.js'
export {get, type GetDatabaseSettingResult} from './get.js'
export {update, type UpdateDatabaseSettingResult} from './update.js'

export const databaseSettingsExtensions = extendResource('data', 'databaseSettings', ctx => ({
  get: <K extends DatabaseSettingKey>(
    appIdentity: string,
    key: K,
    databaseIdentity?: string,
    options?: DatabaseSettingsOptions,
  ) => get(ctx, appIdentity, key, databaseIdentity, options),
  getAll: (
    appIdentity: string,
    databaseIdentity?: string,
    options?: DatabaseSettingsOptions,
  ) => getAll(ctx, appIdentity, databaseIdentity, options),
  update: <K extends DatabaseSettingKey>(
    appIdentity: string,
    key: K,
    value: DatabaseSetting<K>['value'],
    databaseIdentity?: string,
    options?: DatabaseSettingsOptions,
  ) => update(ctx, appIdentity, key, value, databaseIdentity, options),
}))
