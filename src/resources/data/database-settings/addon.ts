import type {ResolvedPgDatabase} from '../internal/resolve-pg-database.js'

/**
 * The database add-on named in `data.databaseSettings` results and errors. It
 * carries only what callers need to identify the database, so the public shape
 * doesn't change when the database resolver's result does.
 */
export type DatabaseSettingsAddon = Pick<ResolvedPgDatabase, 'id' | 'name'>

export function toDatabaseSettingsAddon({id, name}: DatabaseSettingsAddon): DatabaseSettingsAddon {
  return {id, name}
}
