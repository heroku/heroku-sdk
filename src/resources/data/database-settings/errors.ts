import type {PostgresAddonLike} from '../internal/postgres-utils.js'

/**
 * Thrown when a database's settings don't include the requested key. The
 * settings endpoint only returns the keys the database's tier supports, so this
 * usually means the setting isn't available on that database.
 */
export class UnknownSettingError extends Error {
  public readonly id = 'unknown_database_setting'

  constructor(public readonly addon: PostgresAddonLike & {name: string}, public readonly key: string) {
    super(`${key} isn't a setting available on ${addon.name}.`)
    this.name = 'UnknownSettingError'
  }

  public get body() {
    return {id: this.id, message: this.message}
  }
}
