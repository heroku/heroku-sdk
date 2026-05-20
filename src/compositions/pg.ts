import type {HerokuApiClientOptions} from '@heroku/api-client'
import type {
  DatabaseInfoResult,
  DatabasePrepareUpgradeResult,
  DatabaseRunUpgradeResult,
  MaintenanceInfoResult,
  PostgresDatabaseListCredentialsResult,
  TransferListByAppResult,
} from '@heroku/types/data'

import type {ResolveAddonOptions, ResolvedAddOn} from './add-on.js'

import {createDataClient} from '../services/data.js'
import {resolveAddon, resolveAddonByAttachment} from './add-on.js'

const DEFAULT_PG_ATTACHMENT = 'DATABASE_URL'

export type PgOptions = {
  clientOptions?: HerokuApiClientOptions
  signal?: AbortSignal
}

export type PgUpgradeOpts = {
  version?: string
}

/**
 * Resolve a Heroku Postgres branch reference of the form
 * `parent-app::branch-name` (or a bare `branch-name` when an
 * `appIdentity` is provided in options as a fallback).
 *
 * The reference syntax is data-specific: the part before `::` is
 * the parent app, the part after is the branch's add-on name. This
 * is *not* the same as the `service::name` credential reference
 * understood by `resolveAddon` directly. Use this function for any
 * Heroku Postgres command that accepts the `parent::branch` shape.
 *
 * Examples:
 *   resolvePgBranchAddon('parent-app::branch')
 *   resolvePgBranchAddon('branch-name', {appIdentity: 'parent-app'})
 *
 * If the reference has no `::` and no `appIdentity` is provided,
 * the reference is resolved as a bare add-on identity.
 */
export async function resolvePgBranchAddon(
  reference: string,
  options: ResolveAddonOptions = {},
): Promise<ResolvedAddOn> {
  const {addon, app} = parseAddonReference(reference, options.appIdentity)
  return resolveAddon(addon, {...options, appIdentity: app})
}

function parseAddonReference(
  reference: string,
  fallbackApp?: string,
): {addon: string; app?: string} {
  const match = reference.match(/^(.+)::(.+)$/)
  if (match) {
    return {addon: match[2], app: match[1]}
  }

  return fallbackApp ? {addon: reference, app: fallbackApp} : {addon: reference}
}

export async function describePgDatabase(
  appIdentity: string,
  addonIdentity?: string,
  options: PgOptions = {},
): Promise<DatabaseInfoResult> {
  options.signal?.throwIfAborted()
  const addonId = await resolveAddonId(appIdentity, addonIdentity, options.clientOptions)
  const data = createDataClient(options.clientOptions)
  return data.database.info(addonId)
}

export async function listPgCredentials(
  appIdentity: string,
  addonIdentity?: string,
  options: PgOptions = {},
): Promise<PostgresDatabaseListCredentialsResult> {
  options.signal?.throwIfAborted()
  const addonId = await resolveAddonId(appIdentity, addonIdentity, options.clientOptions)
  const data = createDataClient(options.clientOptions)
  return data.postgresDatabase.listCredentials(addonId)
}

export async function describePgMaintenance(
  appIdentity: string,
  addonIdentity?: string,
  options: PgOptions = {},
): Promise<MaintenanceInfoResult> {
  options.signal?.throwIfAborted()
  const addonId = await resolveAddonId(appIdentity, addonIdentity, options.clientOptions)
  const data = createDataClient(options.clientOptions)
  return data.maintenance.info(addonId)
}

export async function listPgTransfers(
  appIdentity: string,
  options: PgOptions = {},
): Promise<TransferListByAppResult> {
  options.signal?.throwIfAborted()
  const data = createDataClient(options.clientOptions)
  return data.transfer.listByApp(appIdentity)
}

export async function runPgUpgrade(
  appIdentity: string,
  addonIdentity: string | undefined,
  body: PgUpgradeOpts = {},
  options: PgOptions = {},
): Promise<DatabaseRunUpgradeResult> {
  options.signal?.throwIfAborted()
  const addonId = await resolveAddonId(appIdentity, addonIdentity, options.clientOptions)
  const data = createDataClient(options.clientOptions)
  // Cast: routes.js declares hasRequestBody for runUpgrade but the generated
  // HerokuClient interface omits the body param (Shogun spec lacks a request schema).
  const runUpgrade = data.database.runUpgrade as (name: string, body: PgUpgradeOpts) => Promise<DatabaseRunUpgradeResult>
  return runUpgrade(addonId, body)
}

export async function preparePgUpgrade(
  appIdentity: string,
  addonIdentity: string | undefined,
  body: PgUpgradeOpts = {},
  options: PgOptions = {},
): Promise<DatabasePrepareUpgradeResult> {
  options.signal?.throwIfAborted()
  const addonId = await resolveAddonId(appIdentity, addonIdentity, options.clientOptions)
  const data = createDataClient(options.clientOptions)
  // See note on runPgUpgrade.
  const prepareUpgrade = data.database.prepareUpgrade as (name: string, body: PgUpgradeOpts) => Promise<DatabasePrepareUpgradeResult>
  return prepareUpgrade(addonId, body)
}

async function resolveAddonId(
  appIdentity: string,
  addonIdentity: string | undefined,
  clientOptions?: HerokuApiClientOptions,
): Promise<string> {
  const addon = await resolveAddonByAttachment(
    appIdentity,
    addonIdentity ?? DEFAULT_PG_ATTACHMENT,
    {clientOptions},
  )
  return addon.id
}
