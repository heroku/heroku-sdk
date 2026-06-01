import type {Plan} from '@heroku/types/3.sdk'

import type {ResourceCtx} from '../../../core/extend-resource.js'
import type {AddOnOptions, ResolveAddonOptions} from './types.js'

import {AddonNotFoundError} from './errors.js'
import {resolveAddonInternal} from './resolve.js'

/**
 * Subset of {@link ResolveAddonOptions} accepted by
 * {@link listPlansForAddon}. The `addonService` filter is intentionally
 * omitted: once you've pinned an add-on identity, filtering its
 * resolution by service name is nonsensical.
 */
export type ListPlansForAddonOptions = Pick<ResolveAddonOptions, 'appIdentity' | 'signal'>;

/**
 * List the plans available for an add-on service, sorted ascending by
 * `price.cents`. Plans without a price (or with equal prices) are
 * returned later in the list.
 */
export async function listPlans(
  ctx: Pick<ResourceCtx, 'platform'>,
  serviceIdentity: string,
  options: AddOnOptions = {},
): Promise<Plan[]> {
  options.signal?.throwIfAborted()
  const plans = await ctx.platform.plan.listByAddOn(serviceIdentity)
  return [...plans].sort(byPriceCentsAsc)
}

/**
 * List the plans available for the add-on service of an existing
 * add-on, sorted ascending by `price.cents`.
 *
 * Convenience wrapper that resolves the add-on first to look up its
 * `addon_service.name`, then delegates to `listPlans`. Saves callers
 * the dance of fetching the add-on, plucking its service id/name, and
 * passing it through.
 *
 * `addonIdentity` accepts the same forms as `resolveAddon`:
 *   - a UUID
 *   - a globally-unique add-on name
 *   - a namespaced credential reference (`name::SECONDARY`)
 *
 * Pass `appIdentity` via `options` when the add-on identity is
 * scoped to an app (same semantics as `resolveAddon`).
 */
export async function listPlansForAddon(
  ctx: Pick<ResourceCtx, 'platform'>,
  addonIdentity: string,
  options: ListPlansForAddonOptions = {},
): Promise<Plan[]> {
  options.signal?.throwIfAborted()
  const addon = await resolveAddonInternal(ctx.platform, addonIdentity, {
    appIdentity: options.appIdentity,
  })
  // The route accepts either name or id; name is stable across
  // environments and easier to identify in logs.
  const serviceName = addon.addon_service?.name
  if (!serviceName) {
    // The resolve found the add-on but the response was missing the
    // service info we need to look up plans. Treat this as not-found
    // for the caller's purpose (they wanted a plans list and we
    // can't produce one).
    throw new AddonNotFoundError()
  }

  return listPlans(ctx, serviceName, options)
}

function byPriceCentsAsc(a: Plan, b: Plan): number {
  return sortableCents(a) - sortableCents(b)
}

function sortableCents(plan: Plan): number {
  const cents = plan.price?.cents
  return typeof cents === 'number' ? cents : Number.MAX_SAFE_INTEGER
}
