import type {AddOn} from '@heroku/types/3.sdk'

import {HerokuApiClient} from '@heroku/heroku-fetch'

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
 * Note: the Heroku Platform API accepts a `force` body on
 * `DELETE /apps/:app/addons/:addon` but `@heroku/types` lacks
 * `hasRequestBody` on that route, so the SDK dispatcher cannot
 * forward it. The extension calls `HerokuApiClient` directly for
 * the delete step. The `Accept-Expansion: plan` header is set to
 * match the existing CLI behaviour.
 */
export async function destroyAndWait(
  ctx: Pick<ResourceCtx, 'platform'>,
  appIdentity: string,
  addonIdentity: string,
  options: DestroyAndWaitOptions = {},
): Promise<AddOn> {
  options.signal?.throwIfAborted()

  const client = new HerokuApiClient()
  const response = await client.delete(
    `/apps/${encodeURIComponent(appIdentity)}/addons/${encodeURIComponent(addonIdentity)}`,
    {
      headers: {'Accept-Expansion': 'plan'},
      signal: options.signal,
    },
  )

  let addon: AddOnWithDeprovisioning = response.status === 204 || response.headers.get('content-length') === '0'
    ? {} as AddOnWithDeprovisioning
    : await response.json() as AddOnWithDeprovisioning

  if (!options.wait || (addon.state !== 'deprovisioning' && addon.state !== 'provisioning')) {
    return addon as AddOn
  }

  await options.onDeprovisioning?.(addon as AddOn)

  const intervalMs = options.waitIntervalMs ?? DEFAULT_DESTROY_WAIT_INTERVAL_MS
  const platform = ctx.platform.withHeaders({'Accept-Expansion': 'plan'})

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
