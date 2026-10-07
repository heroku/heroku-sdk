import type {AddOn} from '@heroku/types/3.sdk'

import type {ResourceCtx} from '../../../core/extend-resource.js'
import type {PlatformClient} from '../../../services/platform.js'
import type {
  ResolveAddonOptions, ResolvedAddOn,
} from './types.js'

import {debug} from './debug.js'
import {AddonAmbiguousError, AddonNotFoundError} from './errors.js'

/**
 * Resolve a Platform add-on by identity.
 *
 * The add-on identity may be:
 *   - an add-on UUID (`d5e3f2a4-...`)
 *   - a globally-unique add-on name (`postgres-curved-12345`)
 *   - an add-on service slug (`heroku-postgresql`)
 *   - an add-on plan slug (`heroku-postgresql:essential-0`)
 *
 * It may also be an add-on attachment identity:
 *   - an attachment UUID (`2a4d5e3f-...`), name (`DATABASE`), or config
 *     var (`DATABASE_URL`). These identities require `appIdentity`.
 *   - an attachment name or config var prefixed with the app name
 *     (`my-app::DATABASE`, `my-app::DATABASE_URL`).
 *
 * `addonService` (e.g. `heroku-postgresql`) is filtered client-side after
 * the resolve. The platform's server-side `addon_service` filter excludes
 * alpha add-ons, so we don't pass it through.
 *
 * Errors:
 *   - throws `AddonNotFoundError` if no match is found
 *   - throws `AddonAmbiguousError` if multiple matches remain after filtering
 */
export async function resolveAddon(
  ctx: Pick<ResourceCtx, 'platform'>,
  addonIdentity: string,
  options: ResolveAddonOptions = {},
): Promise<ResolvedAddOn> {
  options.signal?.throwIfAborted()
  return resolveAddonInternal(ctx.platform, addonIdentity, options)
}

export async function resolveAddonInternal(
  platform: PlatformClient,
  addonIdentity: string,
  options: {addonService?: string; appIdentity?: string} = {},
): Promise<ResolvedAddOn> {
  const {addonService, appIdentity} = options

  // If the add-on identity is app-scoped (contains `::`), we do not pass `appIdentity`
  const app = appIdentity && !addonIdentity.includes('::') ? appIdentity : undefined
  const body = app ? {addon: addonIdentity, app} : {addon: addonIdentity}

  debug('resolve addon=%s app=%s service=%s', addonIdentity, app ?? '<global>', addonService ?? '<any>')
  const matches = await platform.addOn.resolution(body)
  const filtered = addonService
    ? matches.filter(addon => addon.addon_service?.name === addonService)
    : matches

  debug('resolve matches=%d filtered=%d (service=%s)', matches.length, filtered.length, addonService ?? '<any>')
  const resolvedAddon = singularize(filtered)
  debug('resolve resolved addon=%s app=%s', resolvedAddon.id, resolvedAddon.app.id)
  return resolvedAddon
}

function singularize(matches: AddOn[]): ResolvedAddOn {
  if (matches.length === 0) {
    throw new AddonNotFoundError()
  }

  if (matches.length > 1) {
    throw new AddonAmbiguousError(matches)
  }

  const match = matches[0]
  if (!match.id || !match.app?.id) {
    throw new Error(`Resolved add-on is missing required fields (id=${match.id}, app.id=${match.app?.id})`)
  }

  return match as ResolvedAddOn
}
