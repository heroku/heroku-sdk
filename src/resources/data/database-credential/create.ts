import type {
  PostgresCredentialCreateOpts, PostgresCredentialCreateResult, PostgresDatabaseCreateCredentialsResult,
} from '@heroku/types/data'

import type {ResourceCtx} from '../../../core/extend-resource.js'
import type {ResolvedAddOn} from '../../platform/add-on/types.js'
import type {DatabaseCredentialOptions} from './index.js'

import {withSignal} from '../../../core/with-signal.js'
import {resolveAddonInternal} from '../../platform/add-on/resolve.js'
import {getPostgresServiceName, isAdvancedDatabase, isEssentialTier} from '../internal/postgres-utils.js'

export type CreateDatabaseCredentialResult = {
  addon: ResolvedAddOn
  credential: PostgresCredentialCreateResult | PostgresDatabaseCreateCredentialsResult
}

/**
 * Creates a credential on a Postgres database, dispatching to the
 * Advanced-tier or classic-tier endpoint based on the resolved add-on's plan.
 *
 * Essential and legacy Essential-tier databases don't support custom credentials.
 *
 * Returns the resolved addon alongside the created credential
 */
export async function create(
  ctx: Pick<ResourceCtx, 'data' | 'platform'>,
  addonIdentity: string,
  body: PostgresCredentialCreateOpts,
  options: DatabaseCredentialOptions = {},
): Promise<CreateDatabaseCredentialResult> {
  const {appIdentity, signal} = options
  signal?.throwIfAborted()
  // Bind the signal so the resolve and create requests abort in flight.
  const platform = withSignal(ctx.platform, signal)
  const addon = await resolveAddonInternal(platform, addonIdentity, {
    addonService: getPostgresServiceName(), appIdentity,
  })

  if (isEssentialTier(addon)) {
    throw new Error('You can\'t create custom credentials on Essential-tier databases.')
  }

  const data = withSignal(ctx.data, signal)

  const credential = await (isAdvancedDatabase(addon)
    ? data.postgresCredential.create(addon.id, body)
    : data.postgresDatabase.createCredentials(addon.id, body))

  return {addon, credential}
}
