import type {
  TransferScheduleCreateOpts,
  TransferScheduleCreateResult,
  TransferScheduleDeleteResult,
} from '@heroku/types/data'

import type {ResourceCtx} from '../../core/extend-resource.js'

import {extendResource} from '../../core/extend-resource.js'
import {getArbitraryLegacyDB} from './internal/postgres-utils.js'
import {resolvePgDatabase} from './internal/resolve-pg-database.js'

// The OpenAPI spec declares no fixed response schema for transferSchedule.list
// (@heroku/types' TransferScheduleListResult is `Record<string, unknown>`),
// so we use a custom type here.
export type TransferSchedule = {
  hour: number,
  name: string,
  timezone: string,
  uuid: string,
}

export type TransferScheduleOptions = {
  signal?: AbortSignal
}

export async function list(
  ctx: Pick<ResourceCtx, 'data' | 'platform'>,
  appIdentity: string,
  options: TransferScheduleOptions = {},
): Promise<TransferSchedule[]> {
  options.signal?.throwIfAborted()
  // Schedules are app-scoped, so any legacy DB ID unlocks the app's list.
  const addon = await getArbitraryLegacyDB(ctx, appIdentity)
  return ctx.data.transferSchedule.list(addon.id) as unknown as Promise<TransferSchedule[]>
}

export async function create(
  ctx: Pick<ResourceCtx, 'data' | 'platform'>,
  appIdentity: string,
  addonIdentity: string | undefined,
  body: TransferScheduleCreateOpts,
  options: TransferScheduleOptions = {},
): Promise<TransferScheduleCreateResult> {
  options.signal?.throwIfAborted()
  const {addon, attachment} = await resolvePgDatabase(ctx, {
    appIdentity, includeAttachment: true, input: addonIdentity, ...options,
  })

  let requestBody = body
  if (!requestBody.schedule_name) {
    // eslint-disable-next-line camelcase
    requestBody = {...body, schedule_name: `${attachment.name}_URL`}
  }

  return ctx.data.transferSchedule.create(addon.id, requestBody)
}

export async function del(
  ctx: Pick<ResourceCtx, 'data' | 'platform'>,
  appIdentity: string,
  addonIdentity: string | undefined,
  scheduleId: string,
  options: TransferScheduleOptions = {},
): Promise<TransferScheduleDeleteResult> {
  options.signal?.throwIfAborted()
  const addon = await resolvePgDatabase(ctx, {appIdentity, input: addonIdentity, ...options})
  return ctx.data.transferSchedule.delete(addon.id, scheduleId)
}

export const transferScheduleExtensions = extendResource('data', 'transferSchedule', ctx => ({
  create: (
    appIdentity: string,
    addonIdentity: string | undefined,
    body: TransferScheduleCreateOpts,
    options?: TransferScheduleOptions,
  ) => create(ctx, appIdentity, addonIdentity, body, options),
  delete: (
    appIdentity: string,
    addonIdentity: string | undefined,
    scheduleId: string,
    options?: TransferScheduleOptions,
  ) => del(ctx, appIdentity, addonIdentity, scheduleId, options),
  list: (
    appIdentity: string,
    options?: TransferScheduleOptions,
  ) => list(ctx, appIdentity, options),
}))
