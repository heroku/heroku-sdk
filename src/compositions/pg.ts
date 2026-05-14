import type {HerokuApiClientOptions} from '@heroku/api-client'
import type {AddOnAttachment} from '@heroku/types/3.sdk'
import type {
  DatabaseInfoResult,
  DatabasePrepareUpgradeResult,
  DatabaseRunUpgradeResult,
  MaintenanceInfoResult,
  PostgresDatabaseListCredentialsResult,
  TransferListByAppResult,
} from '@heroku/types/data'

import {createDataClient} from '../services/data.js'
import {createPlatformClient} from '../services/platform.js'

export type PgOptions = {
  clientOptions?: HerokuApiClientOptions
  signal?: AbortSignal
}

export type PgUpgradeOpts = {
  version?: string
}

export async function info(
  appIdentity: string,
  addonIdentity?: string,
  options: PgOptions = {},
): Promise<DatabaseInfoResult> {
  options.signal?.throwIfAborted()
  const addonId = await resolveAddonId(appIdentity, addonIdentity, options.clientOptions)
  const data = createDataClient(options.clientOptions)
  return data.database.info(addonId)
}

export async function credentials(
  appIdentity: string,
  addonIdentity?: string,
  options: PgOptions = {},
): Promise<PostgresDatabaseListCredentialsResult> {
  options.signal?.throwIfAborted()
  const addonId = await resolveAddonId(appIdentity, addonIdentity, options.clientOptions)
  const data = createDataClient(options.clientOptions)
  return data.postgresDatabase.listCredentials(addonId)
}

export async function maintenance(
  appIdentity: string,
  addonIdentity?: string,
  options: PgOptions = {},
): Promise<MaintenanceInfoResult> {
  options.signal?.throwIfAborted()
  const addonId = await resolveAddonId(appIdentity, addonIdentity, options.clientOptions)
  const data = createDataClient(options.clientOptions)
  return data.maintenance.info(addonId)
}

export async function backups(
  appIdentity: string,
  options: PgOptions = {},
): Promise<TransferListByAppResult> {
  options.signal?.throwIfAborted()
  const data = createDataClient(options.clientOptions)
  return data.transfer.listByApp(appIdentity)
}

export async function upgradeRun(
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

export async function upgradePrepare(
  appIdentity: string,
  addonIdentity: string | undefined,
  body: PgUpgradeOpts = {},
  options: PgOptions = {},
): Promise<DatabasePrepareUpgradeResult> {
  options.signal?.throwIfAborted()
  const addonId = await resolveAddonId(appIdentity, addonIdentity, options.clientOptions)
  const data = createDataClient(options.clientOptions)
  // See note on upgradeRun.
  const prepareUpgrade = data.database.prepareUpgrade as (name: string, body: PgUpgradeOpts) => Promise<DatabasePrepareUpgradeResult>
  return prepareUpgrade(addonId, body)
}

async function resolveAddonId(
  appIdentity: string,
  addonIdentity: string | undefined,
  clientOptions?: HerokuApiClientOptions,
): Promise<string> {
  const platform = createPlatformClient(clientOptions)
  const matches = await platform.addOnAttachment.resolution({
    // eslint-disable-next-line camelcase
    addon_attachment: addonIdentity ?? 'DATABASE_URL',
    app: appIdentity,
  })

  const attachment: AddOnAttachment | undefined = matches[0]
  const addonId = attachment?.addon?.id
  if (!addonId) {
    throw new Error(`Could not resolve add-on for ${appIdentity}${addonIdentity ? `::${addonIdentity}` : ''}`)
  }

  return addonId
}
