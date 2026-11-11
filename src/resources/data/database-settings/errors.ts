import {type DatabaseSettingsAddon, toDatabaseSettingsAddon} from './addon.js'

/**
 * Thrown when a database's settings don't include the requested key. The
 * settings endpoint only returns the keys the database's tier supports, so this
 * usually means the setting isn't available on that database.
 */
export class UnknownDatabaseSettingError extends Error {
  public readonly addon: DatabaseSettingsAddon
  public readonly id = 'unknown_database_setting'

  constructor(
    addon: DatabaseSettingsAddon,
    public readonly key: string,
    message = `${key} isn't a setting available on ${addon.name}.`,
  ) {
    super(message)
    this.addon = toDatabaseSettingsAddon(addon)
    this.name = 'UnknownDatabaseSettingError'
  }

  public get body() {
    return {id: this.id, message: this.message}
  }
}

/**
 * Thrown when `data.databaseSettings` is used on an Advanced-tier database.
 * Advanced-tier settings use a different API: use `data.postgresSettings`.
 * Carries the add-on so callers can name it without a second resolve call.
 */
export class AdvancedDatabaseNotSupportedError extends Error {
  public readonly addon: DatabaseSettingsAddon
  public readonly id = 'advanced_database_not_supported'

  constructor(addon: DatabaseSettingsAddon) {
    super(`These database settings aren't supported on Advanced-tier databases. ${addon.name} is an Advanced-tier database.`)
    this.addon = toDatabaseSettingsAddon(addon)
    this.name = 'AdvancedDatabaseNotSupportedError'
  }

  public get body() {
    return {id: this.id, message: this.message}
  }
}
