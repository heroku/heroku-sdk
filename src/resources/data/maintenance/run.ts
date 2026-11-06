import type {MaintenanceRunResult} from '@heroku/types/data'

import type {ResourceCtx} from '../../../core/extend-resource.js'
import type {MaintenanceCallPreview, MaintenanceOptions} from './index.js'

import {withSignal} from '../../../core/with-signal.js'
import {resolveAddonInternal} from '../../platform/add-on/resolve.js'
import {isEssentialTier} from '../internal/postgres-utils.js'

export type RunMaintenanceOptions = MaintenanceOptions & {
  beforeRun?: (preview: MaintenanceCallPreview) => Promise<void> | void
}

export type RunMaintenanceResult = {
  addon: MaintenanceCallPreview['addon']
  result: MaintenanceRunResult
}

export async function run(
  ctx: Pick<ResourceCtx, 'data' | 'platform'>,
  addonIdentity: string,
  options: RunMaintenanceOptions = {},
): Promise<RunMaintenanceResult> {
  const {appIdentity, beforeRun, signal} = options
  signal?.throwIfAborted()
  const platform = withSignal(ctx.platform, signal)
  const addon = await resolveAddonInternal(platform, addonIdentity, {appIdentity})

  if (isEssentialTier(addon)) {
    throw new Error('You can\'t trigger maintenance on an Essential tier database.')
  }

  await beforeRun?.({addon})
  signal?.throwIfAborted()

  const data = withSignal(ctx.data, signal)
  const result = await data.maintenance.run(addon.id)

  return {addon, result}
}
