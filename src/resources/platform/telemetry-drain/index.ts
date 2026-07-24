import type {TelemetryDrainOptions, TelemetryDrainTarget} from './types.js'

import {extendResource} from '../../../core/extend-resource.js'
import {removeDrainsForTarget} from './remove-drains-for-target.js'

export {removeDrainsForTarget} from './remove-drains-for-target.js'
export type {TelemetryDrainOptions, TelemetryDrainTarget} from './types.js'

export const telemetryDrainExtensions = extendResource('platform', 'telemetryDrain', ctx => ({
  removeDrains: (target: TelemetryDrainTarget, options?: TelemetryDrainOptions) =>
    removeDrainsForTarget(ctx, target, options),
}))
