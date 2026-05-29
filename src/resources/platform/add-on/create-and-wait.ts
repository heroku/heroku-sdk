import type {AddOn, AddOnCreateOpts} from '@heroku/types/3.sdk'

import {HerokuApiError} from '@heroku/heroku-fetch'

import type {ResourceCtx} from '../../../core/extend-resource.js'
import type {CreateAndWaitOptions} from './types.js'

import {AddonConfirmationRequiredError, AddonProvisioningFailedError} from './errors.js'

const DEFAULT_CREATE_WAIT_INTERVAL_MS = 5000

/**
 * Create an add-on and optionally wait for provisioning to complete.
 *
 * Wraps `addOn.create` with three pieces of orchestration:
 *
 *   - 423 `confirmation_required` from the platform is converted to a
 *     typed `AddonConfirmationRequiredError`. Callers should catch
 *     this, prompt the user for confirmation, and retry the call with
 *     `body.confirm` set.
 *   - When `wait: true` is set, polls `addOn.infoByApp` on a
 *     `waitIntervalMs` cadence until the add-on's `state` is no longer
 *     `provisioning`. Throws `AddonProvisioningFailedError` if the
 *     terminal state is `deprovisioned`.
 *   - `options.onProvisioning` fires once after the create response
 *     when polling is about to begin, letting callers surface a
 *     two-phase status display ("Created" → "Waiting").
 *
 * Both the create and poll calls are issued with `Accept-Expansion:
 * addon_service,plan` so the response includes the full plan shape
 * (price, unit, etc.). The create call additionally sets
 * `X-Heroku-Legacy-Provider-Messages: true` to opt into
 * provider-supplied `provision_message` text on the response — without
 * it the platform silently omits that field.
 */
export async function createAndWait(
  ctx: Pick<ResourceCtx, 'platform'>,
  appIdentity: string,
  body: AddOnCreateOpts,
  options: CreateAndWaitOptions = {},
): Promise<AddOn> {
  options.signal?.throwIfAborted()

  const platform = ctx.platform.withHeaders({'Accept-Expansion': 'addon_service,plan'})

  let addon: AddOn
  try {
    addon = await platform
      .withHeaders({'X-Heroku-Legacy-Provider-Messages': 'true'})
      .addOn.create(appIdentity, body)
  } catch (error) {
    if (error instanceof HerokuApiError && error.id === 'confirmation_required') {
      throw new AddonConfirmationRequiredError(error.message)
    }

    throw error
  }

  if (!options.wait || addon.state !== 'provisioning') {
    if (addon.state === 'deprovisioned') {
      throw new AddonProvisioningFailedError(addon)
    }

    return addon
  }

  await options.onProvisioning?.(addon)

  const intervalMs = options.waitIntervalMs ?? DEFAULT_CREATE_WAIT_INTERVAL_MS

  while (addon.state === 'provisioning') {
    options.signal?.throwIfAborted()
    // eslint-disable-next-line no-await-in-loop
    await wait(intervalMs, options.signal)
    // eslint-disable-next-line no-await-in-loop
    addon = await platform.addOn.infoByApp(appIdentity, addon.name!)
  }

  if (addon.state === 'deprovisioned') {
    throw new AddonProvisioningFailedError(addon)
  }

  return addon
}

function wait(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    function onAbort() {
      clearTimeout(timer)
      reject(signal!.reason ?? new Error('Aborted'))
    }

    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)

    if (signal) {
      if (signal.aborted) {
        clearTimeout(timer)
        reject(signal.reason ?? new Error('Aborted'))
        return
      }

      signal.addEventListener('abort', onAbort, {once: true})
    }
  })
}
