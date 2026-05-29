import type {AddOn} from '@heroku/types/3.sdk'

import type {ResourceCtx} from '../../../core/extend-resource.js'
import type {UpgradeAddOnOptions} from './types.js'

import {debug} from './debug.js'
import {resolveAddonInternal} from './resolve.js'

/**
 * Change the plan of an add-on.
 *
 * Resolves the add-on first so the caller can pass any identifier
 * (UUID, globally unique name, or namespaced `service::name`). When
 * `appIdentity` is provided, the resolve is scoped to that app and
 * falls back to a global resolve if the platform returns 404 add_on.
 *
 * If `plan` is unqualified (no `:`), it's prefixed with the resolved
 * add-on's `addon_service.name` — so callers can pass `hobby` rather
 * than `heroku-redis:hobby` if they don't already know the service.
 *
 * `options.onResolved` fires after the resolve and before the update,
 * receiving the resolved add-on. Useful for surfacing pre-update
 * state (the add-on's current plan, app, etc.) without an extra
 * round-trip.
 */
export async function upgrade(
  ctx: Pick<ResourceCtx, 'platform'>,
  addonIdentity: string,
  plan: string,
  options: UpgradeAddOnOptions = {},
): Promise<AddOn> {
  options.signal?.throwIfAborted()

  const addon = await resolveAddonInternal(ctx.platform, addonIdentity, {
    addonService: options.addonService,
    appIdentity: options.appIdentity,
  })

  await options.onResolved?.(addon)

  options.signal?.throwIfAborted()
  const qualifiedPlan = plan.includes(':')
    ? plan
    : `${(addon.addon_service as undefined | {name?: string})?.name}:${plan}`
  if (qualifiedPlan !== plan) {
    debug('upgrade plan qualified plan=%s qualified=%s', plan, qualifiedPlan)
  }

  debug('upgrade addon=%s app=%s plan=%s', addon.id, addon.app.id, qualifiedPlan)
  return ctx.platform.addOn.update(addon.app.id, addon.id, {plan: qualifiedPlan})
}
