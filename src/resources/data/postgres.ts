import type {PostgresRunUpgradeOpts, PostgresRunUpgradeResult} from '@heroku/types/data'

import type {ResourceCtx} from '../../core/extend-resource.js'
import type {ResolvedPgDatabase} from './internal/resolve-pg-database.js'

import {extendResource} from '../../core/extend-resource.js'
import {withSignal} from '../../core/with-signal.js'
import {isAdvancedDatabase, NotAdvancedDatabaseError} from './internal/postgres-utils.js'
import {resolvePgDatabase} from './internal/resolve-pg-database.js'

export type RunUpgradeOptions = {
  beforeRunUpgrade?: (preview: {addon: ResolvedPgDatabase; currentVersion: string}) => Promise<void> | void
  signal?: AbortSignal
}

export type RunUpgradeResult = {
  addon: ResolvedPgDatabase
  result: PostgresRunUpgradeResult
}

/**
 * Resolves a Postgres database by attachment identity and runs a version upgrade.
 *
 * Throws `NotAdvancedDatabaseError` (carrying the resolved add-on) if the
 * database isn't an Advanced-tier database. If provided, `beforeRunUpgrade`
 * runs after resolution/tier-checking (and the current-version lookup) but
 * before the upgrade request fires; an abort during the hook prevents the
 * upgrade.
 */
export async function runUpgrade(
  ctx: Pick<ResourceCtx, 'data' | 'platform'>,
  appIdentity: string,
  addonIdentity?: string,
  body: PostgresRunUpgradeOpts = {},
  options: RunUpgradeOptions = {},
): Promise<RunUpgradeResult> {
  const {beforeRunUpgrade, signal} = options
  signal?.throwIfAborted()

  const addon = await resolvePgDatabase(ctx, appIdentity, {input: addonIdentity, signal})

  if (!isAdvancedDatabase(addon)) {
    throw new NotAdvancedDatabaseError(addon, `You can only use postgres.runUpgrade() on Advanced-tier databases. ${addon.name} isn't an Advanced-tier database.`)
  }

  // Bind the signal so the info and upgrade requests abort in flight.
  const data = withSignal(ctx.data, signal)
  const {version: currentVersion} = await data.postgres.info(addon.id)

  await beforeRunUpgrade?.({addon, currentVersion})
  signal?.throwIfAborted()

  const result = await data.postgres.runUpgrade(addon.id, body)

  return {addon, result}
}

export const postgresExtensions = extendResource('data', 'postgres', ctx => ({
  runUpgrade: (
    appIdentity: string,
    addonIdentity?: string,
    body?: PostgresRunUpgradeOpts,
    options?: RunUpgradeOptions,
  ) => runUpgrade(ctx, appIdentity, addonIdentity, body, options),
}))
