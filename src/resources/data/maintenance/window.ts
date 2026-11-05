import type {
  MaintenanceUpdateWindowOpts,
  MaintenanceUpdateWindowResult,
  MaintenanceWindowResult,
} from '@heroku/types/data'

import type {ResourceCtx} from '../../../core/extend-resource.js'
import type {MaintenanceCallPreview, MaintenanceOptions} from './index.js'

import {withSignal} from '../../../core/with-signal.js'
import {resolveAddonInternal} from '../../platform/add-on/resolve.js'

export type GetMaintenanceWindowOptions = MaintenanceOptions & {
  beforeGetWindow?: (preview: MaintenanceCallPreview) => Promise<void> | void
}

export type GetMaintenanceWindowResult = {
  addon: MaintenanceCallPreview['addon']
  window: MaintenanceWindowResult
}

export async function getWindow(
  ctx: Pick<ResourceCtx, 'data' | 'platform'>,
  addonIdentity: string,
  options: GetMaintenanceWindowOptions = {},
): Promise<GetMaintenanceWindowResult> {
  const {appIdentity, beforeGetWindow, signal} = options
  signal?.throwIfAborted()
  const platform = withSignal(ctx.platform, signal)
  const addon = await resolveAddonInternal(platform, addonIdentity, {appIdentity})

  await beforeGetWindow?.({addon})
  signal?.throwIfAborted()

  const data = withSignal(ctx.data, signal)
  const window = await data.maintenance.window(addon.id)

  return {addon, window}
}

export type UpdateMaintenanceWindowOptions = MaintenanceOptions & {
  beforeUpdateWindow?: (preview: MaintenanceCallPreview) => Promise<void> | void
}

export type UpdateMaintenanceWindowResult = {
  addon: MaintenanceCallPreview['addon']
  window: MaintenanceUpdateWindowResult
}

export async function updateWindow(
  ctx: Pick<ResourceCtx, 'data' | 'platform'>,
  addonIdentity: string,
  body: MaintenanceUpdateWindowOpts,
  options: UpdateMaintenanceWindowOptions = {},
): Promise<UpdateMaintenanceWindowResult> {
  const {appIdentity, beforeUpdateWindow, signal} = options
  signal?.throwIfAborted()
  const platform = withSignal(ctx.platform, signal)
  const addon = await resolveAddonInternal(platform, addonIdentity, {appIdentity})

  await beforeUpdateWindow?.({addon})
  signal?.throwIfAborted()

  const data = withSignal(ctx.data, signal)
  const window = await data.maintenance.updateWindow(addon.id, body)

  return {addon, window}
}
