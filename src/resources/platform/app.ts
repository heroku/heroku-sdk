import type {App} from '@heroku/types/3.sdk'

import type {ResourceCtx} from '../../core/extend-resource.js'

import {extendResource} from '../../core/extend-resource.js'

export type AppMaintenanceOptions = {
  signal?: AbortSignal
}

export async function enableMaintenance(
  ctx: ResourceCtx,
  appIdentity: string,
  options: AppMaintenanceOptions = {},
): Promise<App> {
  options.signal?.throwIfAborted()
  return ctx.platform.app.update(appIdentity, {maintenance: true})
}

export async function disableMaintenance(
  ctx: ResourceCtx,
  appIdentity: string,
  options: AppMaintenanceOptions = {},
): Promise<App> {
  options.signal?.throwIfAborted()
  return ctx.platform.app.update(appIdentity, {maintenance: false})
}

export const appExtensions = extendResource('platform', 'app', ctx => ({
  disableMaintenance: (appIdentity: string, options?: AppMaintenanceOptions) =>
    disableMaintenance(ctx, appIdentity, options),
  enableMaintenance: (appIdentity: string, options?: AppMaintenanceOptions) =>
    enableMaintenance(ctx, appIdentity, options),
}))
