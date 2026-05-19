import type {
  DatabaseInfoResult,
  DatabasePrepareUpgradeResult,
  DatabaseRunUpgradeResult,
} from '@heroku/types/data'

import type { ResourceCtx } from '../../core/extend-resource.js'

import { extendResource } from '../../core/extend-resource.js'
import { resolveAddonId } from './internal/resolve-addon-id.js'

export type DatabaseOptions = {
  signal?: AbortSignal
}

export type DatabaseUpgradeBody = {
  version?: string
}

export async function describe(
  ctx: ResourceCtx,
  appIdentity: string,
  addonIdentity?: string,
  options: DatabaseOptions = {},
): Promise<DatabaseInfoResult> {
  options.signal?.throwIfAborted()
  const addonId = await resolveAddonId(ctx.platform, appIdentity, addonIdentity)
  return ctx.data.database.info(addonId)
}

export async function runUpgrade(
  ctx: ResourceCtx,
  appIdentity: string,
  addonIdentity?: string,
  body: DatabaseUpgradeBody = {},
  options: DatabaseOptions = {},
): Promise<DatabaseRunUpgradeResult> {
  options.signal?.throwIfAborted()
  const addonId = await resolveAddonId(ctx.platform, appIdentity, addonIdentity)
  // Cast: routes.js declares hasRequestBody for runUpgrade but the generated
  // HerokuClient interface omits the body param (Shogun spec lacks a request schema).
  const fn = ctx.data.database.runUpgrade as
    (name: string, body: DatabaseUpgradeBody) => Promise<DatabaseRunUpgradeResult>
  return fn(addonId, body)
}

export async function prepareUpgrade(
  ctx: ResourceCtx,
  appIdentity: string,
  addonIdentity?: string,
  body: DatabaseUpgradeBody = {},
  options: DatabaseOptions = {},
): Promise<DatabasePrepareUpgradeResult> {
  options.signal?.throwIfAborted()
  const addonId = await resolveAddonId(ctx.platform, appIdentity, addonIdentity)
  // See note on runUpgrade.
  const fn = ctx.data.database.prepareUpgrade as
    (name: string, body: DatabaseUpgradeBody) => Promise<DatabasePrepareUpgradeResult>
  return fn(addonId, body)
}

export const databaseExtensions = extendResource('data', 'database', ctx => ({
  describe: (appIdentity: string, addonIdentity?: string, options?: DatabaseOptions) =>
    describe(ctx, appIdentity, addonIdentity, options),
  prepareUpgrade: (
    appIdentity: string,
    addonIdentity?: string,
    body?: DatabaseUpgradeBody,
    options?: DatabaseOptions,
  ) => prepareUpgrade(ctx, appIdentity, addonIdentity, body, options),
  runUpgrade: (
    appIdentity: string,
    addonIdentity?: string,
    body?: DatabaseUpgradeBody,
    options?: DatabaseOptions,
  ) => runUpgrade(ctx, appIdentity, addonIdentity, body, options),
}))
