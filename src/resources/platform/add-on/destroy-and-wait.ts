import type {AddOn} from '@heroku/types/3.sdk'

import type {ResourceCtx} from '../../../core/extend-resource.js'
import type {DeprovisioningAddOn, DestroyAndWaitOptions} from './types.js'

import {withSignal} from '../../../core/with-signal.js'
import {wait} from '../../../utils/wait.js'
import {AddonProvisioningFailedError} from './errors.js'

const DEFAULT_DESTROY_WAIT_INTERVAL_MS = 5000

/**
 * Delete an add-on and optionally wait for deprovisioning to complete.
 *
 * Wraps `addOn.delete` with two pieces of orchestration:
 *
 *   - When `wait: true` is set, polls `addOn.infoByApp` on a
 *     `waitIntervalMs` cadence until the add-on's `state` is no longer
 *     `deprovisioning`. A 404 response during polling is treated as
 *     successful deprovisioning (the platform deletes the record).
 *   - `options.onDeprovisioning` fires once after the delete response
 *     when polling is about to begin, letting callers surface a
 *     two-phase status display.
 *
 * When `options.force` is set, the delete request sends `{force: true}`
 * as its body (scoped to the delete call only, not the poll requests).
 *
 * Both the delete and the poll requests send `Accept-Expansion: plan`.
 */
export async function destroyAndWait(
  ctx: Pick<ResourceCtx, 'platform'>,
  appIdentity: string,
  addonIdentity: string,
  options: DestroyAndWaitOptions = {},
): Promise<DeprovisioningAddOn> {
  options.signal?.throwIfAborted()

  const platform = withSignal(
    ctx.platform.withHeaders({'Accept-Expansion': 'plan'}),
    options.signal,
  )

  // The force body is scoped to the delete call only — a sticky body on the
  // shared client would leak onto the GET poll requests below.
  const deleteClient = options.force
    ? platform.withOptions({body: {force: true}})
    : platform
  const deleted = await deleteClient.addOn.delete(appIdentity, addonIdentity) as DeprovisioningAddOn | undefined
  let addon: DeprovisioningAddOn = deleted ?? {} as DeprovisioningAddOn

  if (!options.wait || (addon.state !== 'deprovisioning' && addon.state !== 'provisioning')) {
    return addon
  }

  await options.onDeprovisioning?.(addon as AddOn)

  const intervalMs = options.waitIntervalMs ?? DEFAULT_DESTROY_WAIT_INTERVAL_MS

  /* eslint-disable no-await-in-loop */
  while (addon.state === 'deprovisioning' || addon.state === 'provisioning') {
    options.signal?.throwIfAborted()
    await wait(intervalMs, options.signal)

    addon = await (platform.addOn.infoByApp(appIdentity, addonIdentity) as Promise<DeprovisioningAddOn>).catch((error: unknown) => {
      // Platform deletes the record on successful deprovisioning — a 404 is success.
      if (isNotFound(error)) {
        return {...addon, state: 'deprovisioned'} as DeprovisioningAddOn
      }

      throw error
    })
  }
  /* eslint-enable no-await-in-loop */

  if (addon.state !== 'deprovisioned') {
    throw new AddonProvisioningFailedError(addon as AddOn)
  }

  return addon
}

function isNotFound(error: unknown): error is {statusCode: number} {
  return (
    typeof error === 'object'
    && error !== null
    && 'statusCode' in error
    && (error as {statusCode: unknown}).statusCode === 404
  )
}
