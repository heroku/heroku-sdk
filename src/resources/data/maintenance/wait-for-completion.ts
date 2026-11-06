/* eslint-disable no-await-in-loop */
import type {MaintenanceInfoResult} from '@heroku/types/data'

import type {ResourceCtx} from '../../../core/extend-resource.js'
import type {MaintenanceCallPreview, MaintenanceOptions} from './index.js'

import {withSignal} from '../../../core/with-signal.js'
import {wait} from '../../../utils/wait.js'
import {resolveAddonInternal} from '../../platform/add-on/resolve.js'
import {isEssentialTier} from '../internal/postgres-utils.js'

const DEFAULT_INTERVAL_MS = 5000

export type WaitForMaintenanceCompletionOptions = MaintenanceOptions & {
  beforeWait?: (preview: MaintenanceCallPreview) => Promise<void> | void
  /**
   * Polling interval in milliseconds. Defaults to 5000 (5s).
   */
  intervalMs?: number
  /**
   * Maximum total time to wait before throwing. If omitted, polls until
   * maintenance completes or `signal` aborts.
   */
  timeoutMs?: number
}

/**
 * Poll `data.maintenance.info` until the add-on's maintenance status is no
 * longer `running`.
 *
 * Throws if the add-on's maintenance isn't already `running` on the first
 * poll.
 *
 * The add-on is resolved exactly once; subsequent polls use the resolved
 * `addon.id` directly.
 */
export async function waitForCompletion(
  ctx: Pick<ResourceCtx, 'data' | 'platform'>,
  addonIdentity: string,
  options: WaitForMaintenanceCompletionOptions = {},
): Promise<MaintenanceInfoResult> {
  const {
    appIdentity,
    beforeWait,
    intervalMs = DEFAULT_INTERVAL_MS,
    signal,
    timeoutMs,
  } = options

  signal?.throwIfAborted()

  const platform = withSignal(ctx.platform, signal)
  const addon = await resolveAddonInternal(platform, addonIdentity, {appIdentity})

  if (isEssentialTier(addon)) {
    throw new Error('You can\'t await maintenance on an Essential tier database.')
  }

  const data = withSignal(ctx.data, signal)
  const deadline = timeoutMs === undefined ? undefined : Date.now() + timeoutMs

  let maintenance = await data.maintenance.info(addon.id)

  if (maintenance.status !== 'running') {
    throw new Error(`There currently isn't any maintenance in progress for ${addon.name}`)
  }

  await beforeWait?.({addon})
  signal?.throwIfAborted()

  while (true) {
    signal?.throwIfAborted()

    if (maintenance.status !== 'running') {
      return maintenance
    }

    if (deadline !== undefined && Date.now() >= deadline) {
      throw new Error(`Maintenance for addon '${addon.id}' did not complete within ${timeoutMs}ms (last status: ${maintenance.status}).`)
    }

    await wait(intervalMs, signal)

    maintenance = await data.maintenance.info(addon.id)
  }
}
