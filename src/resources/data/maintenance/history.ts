import type {MaintenanceHistoryResult} from '@heroku/types/data'

import type {ResourceCtx} from '../../../core/extend-resource.js'
import type {MaintenanceCallPreview, MaintenanceOptions} from './index.js'

import {withSignal} from '../../../core/with-signal.js'
import {resolveAddonInternal} from '../../platform/add-on/resolve.js'

export type GetMaintenanceHistoryOptions = MaintenanceOptions & {
  beforeHistory?: (preview: MaintenanceCallPreview) => Promise<void> | void
}

export type GetMaintenanceHistoryResult = {
  addon: MaintenanceCallPreview['addon']
  history: MaintenanceHistoryResult
}

export async function history(
  ctx: Pick<ResourceCtx, 'data' | 'platform'>,
  addonIdentity: string,
  query: {limit?: number} = {},
  options: GetMaintenanceHistoryOptions = {},
): Promise<GetMaintenanceHistoryResult> {
  const {appIdentity, beforeHistory, signal} = options
  signal?.throwIfAborted()
  const platform = withSignal(ctx.platform, signal)
  const addon = await resolveAddonInternal(platform, addonIdentity, {appIdentity})

  await beforeHistory?.({addon})
  signal?.throwIfAborted()

  const data = withSignal(ctx.data, signal)
  const history = await data.maintenance.history(addon.id, query)

  return {addon, history}
}
