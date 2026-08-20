/* eslint-disable no-await-in-loop */
import type {Space, SpaceNat} from '@heroku/types/3.sdk'

import type {ResourceCtx} from '../../../core/extend-resource.js'
import type {WaitForAllocatedOptions} from './types.js'

import {wait} from '../../../utils/wait.js'
import {SpaceNotAllocatedError, SpaceNotReadyError} from './errors.js'

const DEFAULT_INTERVAL_MS = 5000
const DEFAULT_TIMEOUT_MS = 20 * 60 * 1000

export type SpaceWithNat = Space & {
  /**
   * The space's NAT info, attached when `options.includeNat` is set and
   * the fetch succeeds. Left `undefined` if `includeNat` was not
   * requested, or if the NAT fetch failed (soft-failure).
   */
  nat?: SpaceNat
}

/**
 * Poll `space.info` until the space's `state` is no longer `allocating`,
 * then return it.
 *
 * If the terminal state is not `allocated` (e.g. `deleting`), throws
 * `SpaceNotAllocatedError`. On exceeding `timeoutMs` without reaching a
 * terminal state, throws `SpaceNotReadyError`.
 *
 * Each poll uses the SDK default `Accept: version=3.sdk` with
 * `Accept-Expansion: region` to match the existing CLI behaviour.
 *
 * When `options.includeNat` is true and the space becomes allocated,
 * also fetches `spaceNat.info` and attaches it as `nat` on the result.
 * That fetch is soft-failure: if it rejects, `nat` is left `undefined`
 * rather than failing the wait. A caller abort during the fetch is the
 * exception — it is re-thrown rather than swallowed.
 */
export async function waitForAllocated(
  ctx: Pick<ResourceCtx, 'platform'>,
  name: string,
  options: WaitForAllocatedOptions = {},
): Promise<SpaceWithNat> {
  const {
    includeNat,
    intervalMs = DEFAULT_INTERVAL_MS,
    signal,
    timeoutMs = DEFAULT_TIMEOUT_MS,
  } = options

  signal?.throwIfAborted()

  let platform = ctx.platform.withHeaders({'Accept-Expansion': 'region'})
  if (signal) {
    platform = platform.withOptions({signal})
  }

  const deadline = Date.now() + timeoutMs

  let space = await platform.space.info(name)

  while (space.state === 'allocating') {
    signal?.throwIfAborted()

    if (Date.now() >= deadline) {
      throw new SpaceNotReadyError(space, timeoutMs)
    }

    await wait(intervalMs, signal)
    space = await platform.space.info(name)
  }

  if (space.state !== 'allocated') {
    throw new SpaceNotAllocatedError(space)
  }

  if (!includeNat) {
    return space
  }

  try {
    const nat = await platform.spaceNat.info(name)
    return {...space, nat}
  } catch {
    // Soft-failure: a rejected NAT fetch leaves `nat` undefined rather than
    // failing the wait — but a caller abort must not be swallowed here, so
    // re-throw it if the signal aborted during the fetch.
    signal?.throwIfAborted()
    return space
  }
}
