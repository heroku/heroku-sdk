import type {
  DatabaseInfoResult,
  DatabasePrepareUpgradeResult,
  DatabaseRunUpgradeResult,
} from '@heroku/types/data'

import type {ResourceCtx} from '../../core/extend-resource.js'

import {extendResource} from '../../core/extend-resource.js'
import {resolvePgDatabase} from './internal/resolve-pg-database.js'

export type DatabaseOptions = {
  signal?: AbortSignal
}

export type DatabaseUpgradeBody = {
  version?: string
}

export type DatabaseDescribeResult = DatabaseInfoResult & {
  following?: string
  num_connections?: number
  num_tables?: number
  postgres_version?: string
  'hot_standby?'?: boolean
  'standalone?'?: boolean
}

export type DatabaseUpgradeWaitResult = {
  'error?': boolean
  message: string
  step: string
  'waiting?': boolean
}

export type DatabaseUpgradeResponse = {
  message: string
}

type DatabaseDataClient = {
  database: {
    cancelUpgrade(name: string): Promise<DatabaseUpgradeResponse>
    dryRunUpgrade(name: string, body: DatabaseUpgradeBody): Promise<DatabaseUpgradeResponse>
    info(name: string): Promise<DatabaseDescribeResult>
    prepareUpgrade(name: string, body: DatabaseUpgradeBody): Promise<DatabaseUpgradeResponse>
    runUpgrade(name: string, body: DatabaseUpgradeBody): Promise<DatabaseUpgradeResponse>
    upgradeWaitStatus(name: string): Promise<DatabaseUpgradeWaitResult>
  }
}

type DatabaseCtx = {data: DatabaseDataClient; platform: ResourceCtx['platform']}

export async function describe(
  ctx: DatabaseCtx,
  appIdentity: string,
  addonIdentity?: string,
  options: DatabaseOptions = {},
): Promise<DatabaseDescribeResult> {
  options.signal?.throwIfAborted()
  const addon = await resolvePgDatabase(ctx, {appIdentity, input: addonIdentity, ...options})
  return ctx.data.database.info(addon.id)
}

export async function upgradeWaitStatus(
  ctx: DatabaseCtx,
  appIdentity: string,
  addonIdentity?: string,
  options: DatabaseOptions = {},
): Promise<DatabaseUpgradeWaitResult> {
  options.signal?.throwIfAborted()
  const addon = await resolvePgDatabase(ctx, {appIdentity, input: addonIdentity, ...options})
  return ctx.data.database.upgradeWaitStatus(addon.id)
}

export async function dryRunUpgrade(
  ctx: DatabaseCtx,
  appIdentity: string,
  addonIdentity?: string,
  body: DatabaseUpgradeBody = {},
  options: DatabaseOptions = {},
): Promise<DatabaseUpgradeResponse> {
  options.signal?.throwIfAborted()
  const addon = await resolvePgDatabase(ctx, {appIdentity, input: addonIdentity, ...options})
  return ctx.data.database.dryRunUpgrade(addon.id, body)
}

export async function runUpgrade(
  ctx: DatabaseCtx,
  appIdentity: string,
  addonIdentity?: string,
  body: DatabaseUpgradeBody = {},
  options: DatabaseOptions = {},
): Promise<DatabaseUpgradeResponse> {
  options.signal?.throwIfAborted()
  const addon = await resolvePgDatabase(ctx, {appIdentity, input: addonIdentity, ...options})
  return ctx.data.database.runUpgrade(addon.id, body)
}

export async function prepareUpgrade(
  ctx: DatabaseCtx,
  appIdentity: string,
  addonIdentity?: string,
  body: DatabaseUpgradeBody = {},
  options: DatabaseOptions = {},
): Promise<DatabaseUpgradeResponse> {
  options.signal?.throwIfAborted()
  const addon = await resolvePgDatabase(ctx, {appIdentity, input: addonIdentity, ...options})
  return ctx.data.database.prepareUpgrade(addon.id, body)
}

export async function cancelUpgrade(
  ctx: DatabaseCtx,
  name: string,
  options: DatabaseOptions = {},
): Promise<DatabaseUpgradeResponse> {
  options.signal?.throwIfAborted()
  return ctx.data.database.cancelUpgrade(name)
}

export const databaseExtensions = extendResource('data', 'database', rawCtx => {
  const ctx = rawCtx as unknown as DatabaseCtx
  return {
    cancelUpgrade: (name: string, options?: DatabaseOptions) =>
      cancelUpgrade(ctx, name, options),
    describe: (appIdentity: string, addonIdentity?: string, options?: DatabaseOptions) =>
      describe(ctx, appIdentity, addonIdentity, options),
    dryRunUpgrade: (
      appIdentity: string,
      addonIdentity?: string,
      body?: DatabaseUpgradeBody,
      options?: DatabaseOptions,
    ) => dryRunUpgrade(ctx, appIdentity, addonIdentity, body, options),
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
    upgradeWaitStatus: (appIdentity: string, addonIdentity?: string, options?: DatabaseOptions) =>
      upgradeWaitStatus(ctx, appIdentity, addonIdentity, options),
  }
})
