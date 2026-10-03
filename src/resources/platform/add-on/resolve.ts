import type {AddOn} from '@heroku/types/3.sdk'

import {NotFoundError} from '@heroku/heroku-fetch'

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
 * `addonIdentity` may be an add-on, or an attachment identity that resolves
 * to its add-on via `appIdentity`.
 *
 * The add-on identity may be:
 *   - an add-on UUID (`d5e3f2a4-...`)
 *   - a globally-unique add-on name (`postgres-curved-12345`)
 *
 * The attachment identity may be:
 *   - an attachment UUID (`2a4d5e3f-...`), attachment name (`DATABASE`),
 *     or config var (`DATABASE_URL`); requires `appIdentity` to resolve.
 *   - an app-scoped attachment name or config var (`my-app::DATABASE`,
 *     `my-app::DATABASE_URL`); ignores `appIdentity` in favor of the
 *     scoped app name.
 *
 * When `appIdentity` is provided, the resolve is scoped to that app first
 * and falls back to a global resolve if the platform returns 404 add_on.
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

  const resolveBy = async (app?: string): Promise<ResolvedAddOn> => {
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

  if (!appIdentity || addonIdentity.includes('::')) {
    debug('resolve scope=global reason=%s', appIdentity ? 'app-scoped-identity' : 'no-app')
    return resolveBy()
  }

  try {
    return await resolveBy(appIdentity)
  } catch (error) {
    if (isAddOnNotFound(error)) {
      debug('resolve app-scope 404 add_on, falling back to global addon=%s', addonIdentity)
      return resolveBy()
    }

    throw error
  }
}

function isAddOnNotFound(error: unknown): boolean {
  return error instanceof NotFoundError && error.resource === 'add_on'
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
