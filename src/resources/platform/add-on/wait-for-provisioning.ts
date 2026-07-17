import type {AddOn} from '@heroku/types/3.sdk'

import type {ResourceCtx} from '../../../core/extend-resource.js'
import type {WaitForProvisioningOptions} from './types.js'

import {wait} from '../../../utils/wait.js'
import {AddonProvisioningFailedError} from './errors.js'

const DEFAULT_WAIT_INTERVAL_MS = 5000

// The platform returns 'deprovisioning' as a transient state but @heroku/types
// only models the terminal states. Extend locally rather than ts-ignore.
type AddOnWithDeprovisioning = Omit<AddOn, 'state'> & {
  state?: 'deprovisioning' | AddOn['state']
}

/**
 * Poll add-on state until it leaves a non-terminal state.
 *
 * When `appIdentity` is provided, polls `GET /apps/:app/addons/:addon`
 * (app-scoped). Without it, polls `GET /addons/:addon` (global).
 *
 * Terminal states: `provisioned`, `deprovisioned`. Polling continues
 * while the add-on is in `provisioning` or `deprovisioning`.
 *
 * Throws `AddonProvisioningFailedError` if the terminal state is
 * `deprovisioned`.
 *
 * The `Accept-Expansion: addon_service,plan` header is included on
 * each poll to match the existing CLI behaviour.
 */
export async function waitForProvisioning(
  ctx: Pick<ResourceCtx, 'platform'>,
  addon: AddOn,
  options: WaitForProvisioningOptions = {},
): Promise<AddOn> {
  options.signal?.throwIfAborted()

  const intervalMs = options.waitIntervalMs ?? DEFAULT_WAIT_INTERVAL_MS
  const platform = ctx.platform.withHeaders({'Accept-Expansion': 'addon_service,plan'})

  let current: AddOnWithDeprovisioning = addon

  /* eslint-disable no-await-in-loop */
  while (current.state === 'provisioning' || current.state === 'deprovisioning') {
    options.signal?.throwIfAborted()
    await wait(intervalMs, options.signal)

    current = options.appIdentity
      ? await platform.addOn.infoByApp(options.appIdentity, current.name!) as AddOnWithDeprovisioning
      : await platform.addOn.info(current.name!) as AddOnWithDeprovisioning
  }
  /* eslint-enable no-await-in-loop */

  if (current.state === 'deprovisioned') {
    throw new AddonProvisioningFailedError(current as AddOn)
  }

  return current as AddOn
}
