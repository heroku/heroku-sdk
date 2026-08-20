import type {WaitForAllocatedOptions} from './types.js'

import {extendResource} from '../../../core/extend-resource.js'
import {waitForAllocated} from './wait-for-allocated.js'

export {SpaceNotAllocatedError, SpaceNotReadyError} from './errors.js'
export type {SpaceOptions, WaitForAllocatedOptions} from './types.js'
export {type SpaceWithNat, waitForAllocated} from './wait-for-allocated.js'

export const spaceExtensions = extendResource('platform', 'space', ctx => ({
  waitForAllocated: (name: string, options?: WaitForAllocatedOptions) =>
    waitForAllocated(ctx, name, options),
}))
