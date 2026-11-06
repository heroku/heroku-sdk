import type {MaintenanceInfoResult} from '@heroku/types/data'

import type {ResourceCtx} from '../../../core/extend-resource.js'
import type {MaintenanceCallPreview, MaintenanceOptions} from './index.js'

import {withSignal} from '../../../core/with-signal.js'
import {resolveAddonInternal} from '../../platform/add-on/resolve.js'

export type GetMaintenanceInfoOptions = MaintenanceOptions & {
  beforeInfo?: (preview: MaintenanceCallPreview) => Promise<void> | void
}

export type GetMaintenanceInfoResult = {
  addon: MaintenanceCallPreview['addon']
  maintenance: MaintenanceInfoResult
}

export async function info(
  ctx: Pick<ResourceCtx, 'data' | 'platform'>,
  addonIdentity: string,
  options: GetMaintenanceInfoOptions = {},
): Promise<GetMaintenanceInfoResult> {
  const {appIdentity, beforeInfo, signal} = options
  signal?.throwIfAborted()
  const platform = withSignal(ctx.platform, signal)
  const addon = await resolveAddonInternal(platform, addonIdentity, {appIdentity})

  await beforeInfo?.({addon})
  signal?.throwIfAborted()

  const data = withSignal(ctx.data, signal)
  const maintenance = await data.maintenance.info(addon.id)

  return {addon, maintenance}
}
