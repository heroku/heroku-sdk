import type { HerokuApiClientOptions } from '@heroku/api-client'
import type {
  DatabaseInfoResult,
  DatabasePrepareUpgradeResult,
  DatabaseRunUpgradeResult,
  MaintenanceInfoResult,
  PostgresDatabaseListCredentialsResult,
  TransferListByAppResult,
} from '@heroku/types/data'

import type { ResolveAddonOptions, ResolvedAddOn } from './add-on.js'

import { createDataClient } from '../services/data.js'
import { resolveAddon, resolveAddonByAttachment } from './add-on.js'

const DEFAULT_PG_ATTACHMENT = 'DATABASE_URL'

export type PgOptions = {
  clientOptions?: HerokuApiClientOptions
  signal?: AbortSignal
}

export type PgUpgradeOpts = {
  version?: string
}

export type ResolvePgDatabaseOptions = ResolveAddonOptions & {
  input?: string
}

/**
 * Resolve a Heroku Postgres database add-on from any of the input
 * shapes the platform recognizes:
 *
 *   - omitted → the `DATABASE_URL` attachment on `appIdentity`.
 *   - `DATABASE_URL`, `HEROKU_POSTGRESQL_GREEN`, etc. → that attachment
 *     on `appIdentity`. Detected by SHOUTY_SNAKE_CASE shape.
 *   - `parent-app::branch-name` → branch reference. The portion before
 *     `::` is the parent app; the portion after is the branch add-on
 *     name.
 *   - any other string → a bare add-on identity (UUID, globally-unique
 *     name) routed through `resolveAddon`.
 *
 * Throws `AddonNotFoundError` (or `AddonAmbiguousError`) from the
 * underlying resolver. Throws if no input is given and no `appIdentity`
 * is available to default the attachment lookup to.
 */
export async function resolvePgDatabase(options: ResolvePgDatabaseOptions = {}): Promise<ResolvedAddOn> {
  const { appIdentity, input, ...rest } = options

  if (!input) {
    if (!appIdentity) {
      throw new Error('resolvePgDatabase requires either input or appIdentity to default to DATABASE_URL.')
    }

    return resolveAddonByAttachment(appIdentity, DEFAULT_PG_ATTACHMENT, rest)
  }

  if (input.includes('::')) {
    const { addon, app } = parseBranchReference(input, appIdentity)
    return resolveAddon(addon, { ...rest, appIdentity: app })
  }

  if (appIdentity && isAttachmentName(input)) {
    return resolveAddonByAttachment(appIdentity, input, rest)
  }

  return resolveAddon(input, { ...rest, appIdentity })
}

function isAttachmentName(input: string): boolean {
  return /^[A-Z][A-Z0-9_]*$/.test(input)
}

function parseBranchReference(
  reference: string,
  fallbackApp?: string,
): { addon: string; app?: string } {
  const match = reference.match(/^(.+)::(.+)$/)
  if (match) {
    return { addon: match[2], app: match[1] }
  }

  return fallbackApp ? { addon: reference, app: fallbackApp } : { addon: reference }
}

/**
 * @deprecated Use `sdk.data.database.describe` from `@heroku/sdk/sdk` with
 * `databaseExtensions` from `@heroku/sdk/extensions/data`, or import `describe`
 * directly from `@heroku/sdk/resources/data/database`.
 */
export async function describePgDatabase(
  appIdentity: string,
  addonIdentity?: string,
  options: PgOptions = {},
): Promise<DatabaseInfoResult> {
<<<<<<< HEAD
  options.signal?.throwIfAborted()
  const addon = await resolvePgDatabase({ appIdentity, input: addonIdentity, ...options })
  const data = createDataClient(options.clientOptions)
  return data.database.info(addon.id)
=======
  return databaseResource.describe(makeCtx(options), appIdentity, addonIdentity, {
    signal: options.signal,
  })
>>>>>>> ad20733 (refactor(resources): rename describe_ to describe)
}

/**
 * @deprecated Use `sdk.data.postgresDatabase.listCredentials` from `@heroku/sdk/sdk` with
 * `postgresDatabaseExtensions` from `@heroku/sdk/extensions/data`, or import `listCredentials`
 * directly from `@heroku/sdk/resources/data/postgres-database`.
 */
export async function listPgCredentials(
  appIdentity: string,
  addonIdentity?: string,
  options: PgOptions = {},
): Promise<PostgresDatabaseListCredentialsResult> {
  options.signal?.throwIfAborted()
  const addon = await resolvePgDatabase({ appIdentity, input: addonIdentity, ...options })
  const data = createDataClient(options.clientOptions)
  return data.postgresDatabase.listCredentials(addon.id)
}

/**
 * @deprecated Use `sdk.data.maintenance.info` from `@heroku/sdk/sdk` with
 * `maintenanceExtensions` from `@heroku/sdk/extensions/data`, or import `info`
 * directly from `@heroku/sdk/resources/data/maintenance`.
 */
export async function describePgMaintenance(
  appIdentity: string,
  addonIdentity?: string,
  options: PgOptions = {},
): Promise<MaintenanceInfoResult> {
  options.signal?.throwIfAborted()
  const addon = await resolvePgDatabase({ appIdentity, input: addonIdentity, ...options })
  const data = createDataClient(options.clientOptions)
  return data.maintenance.info(addon.id)
}

/**
 * @deprecated Use `sdk.data.transfer.listByApp` (upstream route — no extension needed),
 * accessed via `sdk` from `@heroku/sdk/sdk` or directly via `createDataClient` from
 * `@heroku/sdk/data`.
 */
export async function listPgTransfers(
  appIdentity: string,
  options: PgOptions = {},
): Promise<TransferListByAppResult> {
  options.signal?.throwIfAborted()
  return makeCtx(options).data.transfer.listByApp(appIdentity)
}

/**
 * @deprecated Use `sdk.data.database.runUpgrade` from `@heroku/sdk/sdk` with
 * `databaseExtensions` from `@heroku/sdk/extensions/data`, or import `runUpgrade`
 * directly from `@heroku/sdk/resources/data/database`.
 */
export async function runPgUpgrade(
  appIdentity: string,
  addonIdentity?: string,
  body: PgUpgradeOpts = {},
  options: PgOptions = {},
): Promise<DatabaseRunUpgradeResult> {
  options.signal?.throwIfAborted()
  const addon = await resolvePgDatabase({ appIdentity, input: addonIdentity, ...options })
  const data = createDataClient(options.clientOptions)
  // Cast: routes.js declares hasRequestBody for runUpgrade but the generated
  // HerokuClient interface omits the body param (Shogun spec lacks a request schema).
  const runUpgrade = data.database.runUpgrade as (name: string, body: PgUpgradeOpts) => Promise<DatabaseRunUpgradeResult>
  return runUpgrade(addon.id, body)
}

/**
 * @deprecated Use `sdk.data.database.prepareUpgrade` from `@heroku/sdk/sdk` with
 * `databaseExtensions` from `@heroku/sdk/extensions/data`, or import `prepareUpgrade`
 * directly from `@heroku/sdk/resources/data/database`.
 */
export async function preparePgUpgrade(
  appIdentity: string,
  addonIdentity?: string,
  body: PgUpgradeOpts = {},
  options: PgOptions = {},
): Promise<DatabasePrepareUpgradeResult> {
  options.signal?.throwIfAborted()
  const addon = await resolvePgDatabase({ appIdentity, input: addonIdentity, ...options })
  const data = createDataClient(options.clientOptions)
  // See note on runPgUpgrade.
  const prepareUpgrade = data.database.prepareUpgrade as (name: string, body: PgUpgradeOpts) => Promise<DatabasePrepareUpgradeResult>
  return prepareUpgrade(addon.id, body)
}
