import type {AddOn} from '@heroku/types/3.sdk'

import type {ResourceCtx} from '../../../core/extend-resource.js'
import type {DestroyAndWaitOptions} from './types.js'

import {wait} from '../../../utils/wait.js'
import {AddonProvisioningFailedError} from './errors.js'

const DEFAULT_DESTROY_WAIT_INTERVAL_MS = 5000

// The platform returns 'deprovisioning' as a transient state but @heroku/types
// only models the terminal states. Extend locally rather than ts-ignore.
type AddOnWithDeprovisioning = Omit<AddOn, 'state'> & {
  state?: 'deprovisioning' | AddOn['state']
}

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
): Promise<AddOn> {
  options.signal?.throwIfAborted()

  const platform = ctx.platform.withOptions({
    headers: {'Accept-Expansion': 'plan'},
    signal: options.signal,
  })

  // The force body is scoped to the delete call only — a sticky body on the
  // shared client would leak onto the GET poll requests below.
  const deleteClient = options.force
    ? platform.withOptions({body: {force: true}})
    : platform
  const deleted = await deleteClient.addOn.delete(appIdentity, addonIdentity) as AddOnWithDeprovisioning | undefined
  let addon: AddOnWithDeprovisioning = deleted ?? {} as AddOnWithDeprovisioning

  if (!options.wait || (addon.state !== 'deprovisioning' && addon.state !== 'provisioning')) {
    return addon as AddOn
  }

  await options.onDeprovisioning?.(addon as AddOn)

  const intervalMs = options.waitIntervalMs ?? DEFAULT_DESTROY_WAIT_INTERVAL_MS

  /* eslint-disable no-await-in-loop */
  while (addon.state === 'deprovisioning' || addon.state === 'provisioning') {
    options.signal?.throwIfAborted()
    await wait(intervalMs, options.signal)

    addon = await (platform.addOn.infoByApp(appIdentity, addonIdentity) as Promise<AddOnWithDeprovisioning>).catch((error: unknown) => {
      // Platform deletes the record on successful deprovisioning — a 404 is success.
      if (isNotFound(error)) {
        return {...addon, state: 'deprovisioned'} as AddOnWithDeprovisioning
      }

      throw error
    })
  }
  /* eslint-enable no-await-in-loop */

  if (addon.state !== 'deprovisioned') {
    throw new AddonProvisioningFailedError(addon as AddOn)
  }

  return addon as AddOn
}

function isNotFound(error: unknown): error is {statusCode: number} {
  return (
    typeof error === 'object'
    && error !== null
    && 'statusCode' in error
    && (error as {statusCode: unknown}).statusCode === 404
  )
}
