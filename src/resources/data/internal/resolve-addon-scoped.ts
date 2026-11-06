import {NotFoundError} from '@heroku/heroku-fetch'

import type {PlatformClient} from '../../../services/platform.js'
import type {ResolvedAddOn} from '../../platform/add-on/types.js'

import {AddonNotFoundError} from '../../platform/add-on/errors.js'
import {resolveAddonInternal} from '../../platform/add-on/resolve.js'

/**
 * Resolve an add-on scoped to `appIdentity` first, then globally, so an add-on
 * owned by a different app still resolves by its globally-unique name.
 *
 * The global retry runs only when the scoped resolve misses the add-on: an
 * empty match (`AddonNotFoundError`) or a 404 labeled `resource: 'add_on'`.
 * Any other 404 — for the app itself (`resource: 'app'`) or one without a
 * resource label — is rethrown, so a mistyped app is never silently ignored. `app::x` identities and calls without
 * an app go straight to the global resolve, since scoping wouldn't apply.
 */
export async function resolveAddonScopedThenGlobal(
  platform: PlatformClient,
  addonIdentity: string,
  options: {addonService?: string; appIdentity?: string} = {},
): Promise<ResolvedAddOn> {
  const {addonService, appIdentity} = options

  if (!appIdentity || addonIdentity.includes('::')) {
    return resolveAddonInternal(platform, addonIdentity, {addonService})
  }

  try {
    return await resolveAddonInternal(platform, addonIdentity, {addonService, appIdentity})
  } catch (error) {
    if (!isAddonMiss(error)) throw error

    return resolveAddonInternal(platform, addonIdentity, {addonService})
  }
}

function isAddonMiss(error: unknown): boolean {
  if (error instanceof AddonNotFoundError) return true
  return error instanceof NotFoundError && error.resource === 'add_on'
}
