import type {
  DatabaseCancelUpgradeResult,
  DatabaseDryRunUpgradeOpts,
  DatabaseDryRunUpgradeResult,
  DatabaseInfoResult,
  DatabasePrepareUpgradeOpts,
  DatabasePrepareUpgradeResult,
  DatabaseRunUpgradeOpts,
  DatabaseRunUpgradeResult,
  DatabaseUpgradeWaitStatusResult,
} from '@heroku/types/data'

import type {ResourceCtx} from '../../core/extend-resource.js'

import {extendResource} from '../../core/extend-resource.js'
import {resolvePgDatabase} from './internal/resolve-pg-database.js'

export type DatabaseOptions = {
  signal?: AbortSignal
}

export type DatabaseDescribeResult = DatabaseInfoResult & {
  following?: string
  'hot_standby?'?: boolean
  num_connections?: number
  num_tables?: number
  postgres_version?: string
  'standalone?'?: boolean
}

export async function describe(
  ctx: Pick<ResourceCtx, 'data' | 'platform'>,
  appIdentity: string,
  addonIdentity?: string,
  options: DatabaseOptions = {},
): Promise<DatabaseDescribeResult> {
  options.signal?.throwIfAborted()
  const addon = await resolvePgDatabase(ctx, {appIdentity, input: addonIdentity, ...options})
  return ctx.data.database.info(addon.id)
}

export async function upgradeWaitStatus(
  ctx: Pick<ResourceCtx, 'data' | 'platform'>,
  appIdentity: string,
  addonIdentity?: string,
  options: DatabaseOptions = {},
): Promise<DatabaseUpgradeWaitStatusResult> {
  options.signal?.throwIfAborted()
  const addon = await resolvePgDatabase(ctx, {appIdentity, input: addonIdentity, ...options})
  return ctx.data.database.upgradeWaitStatus(addon.id)
}

export async function dryRunUpgrade(
  ctx: Pick<ResourceCtx, 'data' | 'platform'>,
  appIdentity: string,
  addonIdentity?: string,
  body: DatabaseDryRunUpgradeOpts = {},
  options: DatabaseOptions = {},
): Promise<DatabaseDryRunUpgradeResult> {
  options.signal?.throwIfAborted()
  const addon = await resolvePgDatabase(ctx, {appIdentity, input: addonIdentity, ...options})
  return ctx.data.database.dryRunUpgrade(addon.id, body)
}

export async function runUpgrade(
  ctx: Pick<ResourceCtx, 'data' | 'platform'>,
  appIdentity: string,
  addonIdentity?: string,
  body: DatabaseRunUpgradeOpts = {},
  options: DatabaseOptions = {},
): Promise<DatabaseRunUpgradeResult> {
  options.signal?.throwIfAborted()
  const addon = await resolvePgDatabase(ctx, {appIdentity, input: addonIdentity, ...options})
  return ctx.data.database.runUpgrade(addon.id, body)
}

export async function prepareUpgrade(
  ctx: Pick<ResourceCtx, 'data' | 'platform'>,
  appIdentity: string,
  addonIdentity?: string,
  body: DatabasePrepareUpgradeOpts = {},
  options: DatabaseOptions = {},
): Promise<DatabasePrepareUpgradeResult> {
  options.signal?.throwIfAborted()
  const addon = await resolvePgDatabase(ctx, {appIdentity, input: addonIdentity, ...options})
  return ctx.data.database.prepareUpgrade(addon.id, body)
}

export async function cancelUpgrade(
  ctx: Pick<ResourceCtx, 'data' | 'platform'>,
  appIdentity: string,
  addonIdentity?: string,
  options: DatabaseOptions = {},
): Promise<DatabaseCancelUpgradeResult> {
  options.signal?.throwIfAborted()
  const addon = await resolvePgDatabase(ctx, {appIdentity, input: addonIdentity, ...options})
  return ctx.data.database.cancelUpgrade(addon.id)
}

export const databaseExtensions = extendResource('data', 'database', ctx => ({
  cancelUpgrade: (appIdentity: string, addonIdentity?: string, options?: DatabaseOptions) =>
    cancelUpgrade(ctx, appIdentity, addonIdentity, options),
  describe: (appIdentity: string, addonIdentity?: string, options?: DatabaseOptions) =>
    describe(ctx, appIdentity, addonIdentity, options),
  dryRunUpgrade: (
    appIdentity: string,
    addonIdentity?: string,
    body?: DatabaseDryRunUpgradeOpts,
    options?: DatabaseOptions,
  ) => dryRunUpgrade(ctx, appIdentity, addonIdentity, body, options),
  prepareUpgrade: (
    appIdentity: string,
    addonIdentity?: string,
    body?: DatabasePrepareUpgradeOpts,
    options?: DatabaseOptions,
  ) => prepareUpgrade(ctx, appIdentity, addonIdentity, body, options),
  runUpgrade: (
    appIdentity: string,
    addonIdentity?: string,
    body?: DatabaseRunUpgradeOpts,
    options?: DatabaseOptions,
  ) => runUpgrade(ctx, appIdentity, addonIdentity, body, options),
  upgradeWaitStatus: (appIdentity: string, addonIdentity?: string, options?: DatabaseOptions) =>
    upgradeWaitStatus(ctx, appIdentity, addonIdentity, options),
}))
