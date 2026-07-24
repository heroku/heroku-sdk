import type {TelemetryDrain} from '@heroku/types/3.sdk'

import type {ResourceCtx} from '../../../core/extend-resource.js'
import type {TelemetryDrainOptions, TelemetryDrainTarget} from './types.js'

/**
 * Remove all telemetry drains for a given app or space.
 *
 * Behavior:
 * - Dispatches to listByApp or listBySpace based on target discriminant
 * - Deletes all drains in parallel via Promise.all
 * - Returns empty array if no drains exist
 * - Rejects if any individual delete fails
 */
export async function removeDrainsForTarget(
  ctx: Pick<ResourceCtx, 'platform'>,
  target: TelemetryDrainTarget,
  options: TelemetryDrainOptions = {},
): Promise<TelemetryDrain[]> {
  const {signal} = options
  const {app, space} = target

  signal?.throwIfAborted()

  const platform = signal ? ctx.platform.withOptions({signal}) : ctx.platform

  let drains: TelemetryDrain[] = []

  if (app) {
    drains = await platform.telemetryDrain.listByApp(app)
  } else if (space) {
    drains = await platform.telemetryDrain.listBySpace(space)
  }

  signal?.throwIfAborted()

  const deletedDrains = await Promise.all(drains.map(drain => platform.telemetryDrain.delete(drain.id)))

  return deletedDrains
}
