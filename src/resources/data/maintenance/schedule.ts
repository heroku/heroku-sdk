import type {MaintenanceScheduleOpts, MaintenanceScheduleResult} from '@heroku/types/data'

import type {ResourceCtx} from '../../../core/extend-resource.js'
import type {MaintenanceCallPreview, MaintenanceOptions} from './index.js'

import {withSignal} from '../../../core/with-signal.js'
import {resolveAddonInternal} from '../../platform/add-on/resolve.js'

export type ScheduleMaintenanceOptions = MaintenanceOptions & {
  beforeSchedule?: (preview: MaintenanceCallPreview) => Promise<void> | void
}

export type ScheduleMaintenanceResult = {
  addon: MaintenanceCallPreview['addon']
  schedule: MaintenanceScheduleResult
}

export async function schedule(
  ctx: Pick<ResourceCtx, 'data' | 'platform'>,
  addonIdentity: string,
  body: MaintenanceScheduleOpts,
  options: ScheduleMaintenanceOptions = {},
): Promise<ScheduleMaintenanceResult> {
  const {appIdentity, beforeSchedule, signal} = options
  signal?.throwIfAborted()
  const platform = withSignal(ctx.platform, signal)
  const addon = await resolveAddonInternal(platform, addonIdentity, {appIdentity})

  await beforeSchedule?.({addon})
  signal?.throwIfAborted()

  const data = withSignal(ctx.data, signal)
  const schedule = await data.maintenance.schedule(addon.id, body)

  return {addon, schedule}
}
