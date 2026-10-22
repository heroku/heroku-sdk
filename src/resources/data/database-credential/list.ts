import type {PostgresCredentialListResult} from '@heroku/types/data'

import type {ResourceCtx} from '../../../core/extend-resource.js'
import type {ResolvedAddOn} from '../../platform/add-on/types.js'

import {withSignal} from '../../../core/with-signal.js'
import {resolveAddonInternal} from '../../platform/add-on/resolve.js'
import {getPostgresServiceName, isAdvancedDatabase} from '../internal/postgres-utils.js'
import {DatabaseCredentialOptions} from './index.js'

/**
 * Thrown by `list` when the resolved add-on is not an Advanced-tier
 * database. Carries the resolved addon so callers that need its identity
 * (e.g. to point the user at the classic-tier equivalent) don't need a
 * second resolve call.
 */
export class NotAdvancedDatabaseError extends Error {
  public readonly id = 'not_advanced_database'

  constructor(public readonly addon: ResolvedAddOn) {
    super(`You can only list credentials on Advanced-tier databases. ${addon.name} isn't an Advanced-tier database.`)
    this.name = 'NotAdvancedDatabaseError'
  }

  public get body() {
    return {id: this.id, message: this.message}
  }
}

export type ListDatabaseCredentialsResult = {
  addon: ResolvedAddOn
  credentials: PostgresCredentialListResult
}

/**
 * Lists credentials on an Advanced-tier Postgres database. Classic-tier
 * databases don't support this endpoint; use `postgresDatabase.listCredentials`
 * for those instead.
 *
 * Throws `NotAdvancedDatabaseError` (carrying the resolved addon) if
 * `addonIdentity` doesn't resolve to an Advanced-tier database.
 */
export async function list(
  ctx: Pick<ResourceCtx, 'data' | 'platform'>,
  addonIdentity: string,
  options: DatabaseCredentialOptions = {},
): Promise<ListDatabaseCredentialsResult> {
  const {appIdentity, signal} = options
  signal?.throwIfAborted()
  // Bind the signal so the resolve and list requests abort in flight.
  const platform = withSignal(ctx.platform, signal)
  const addon = await resolveAddonInternal(platform, addonIdentity, {
    addonService: getPostgresServiceName(), appIdentity,
  })

  if (!isAdvancedDatabase(addon)) {
    throw new NotAdvancedDatabaseError(addon)
  }

  const data = withSignal(ctx.data, signal)
  const credentials = await data.postgresCredential.list(addon.id)

  return {addon, credentials}
}
