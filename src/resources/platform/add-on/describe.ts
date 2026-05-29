import type {AddOn, Plan} from '@heroku/types/3.sdk'

import type {ResourceCtx} from '../../../core/extend-resource.js'
import type {DescribedAddOn, ResolveAddonOptions} from './types.js'

import {resolveAddonInternal} from './resolve.js'

/**
 * Resolve, describe, and decorate an add-on for display.
 *
 * - Resolves the add-on by identity (optionally scoped to an app).
 * - Loads the add-on's attachments.
 * - Returns a copy with `plan.price` set from `billed_price` (so the
 *   value reflects any grandfathered/contract pricing).
 *
 * If `appIdentity` is provided and the platform returns 404 (resource
 * `add_on`), the resolve falls back to a global lookup. This handles
 * the case where the add-on belongs to a different app than the one
 * supplied.
 *
 * Requests the `version=3.sdk` accept variant with `addon_service,plan`
 * expansion so the resolved add-on includes the full `Plan` shape
 * (`price.unit`, etc.) needed to render pricing.
 */
export async function describeAddon(
  ctx: Pick<ResourceCtx, 'platform'>,
  addonIdentity: string,
  options: ResolveAddonOptions = {},
): Promise<DescribedAddOn> {
  options.signal?.throwIfAborted()

  // Accept-Expansion is scoped to the resolve call (addOn.resolution
  // serializer accepts addon_service + plan expansions). The
  // /addons/:id/addon-attachments endpoint uses Accept-Inclusion, not
  // Accept-Expansion, and rejects an unknown expansion header.
  const resolvingPlatform = ctx.platform.withHeaders({
    Accept: 'application/vnd.heroku+json; version=3.sdk',
    'Accept-Expansion': 'addon_service,plan',
  })

  const addon = await resolveAddonInternal(resolvingPlatform, addonIdentity, {
    addonService: options.addonService,
    appIdentity: options.appIdentity,
  })

  options.signal?.throwIfAborted()
  const attachments = await ctx.platform.addOnAttachment.listByAddOn(addon.id)

  const plan = addon.plan as Plan | undefined
  return {
    ...addon,
    ...(plan && {plan: {...plan, price: grandfatheredPrice(addon)} as AddOn['plan']}),
    attachments,
  }
}

function grandfatheredPrice(addon: AddOn): Plan['price'] {
  const price = (addon.plan as Plan | undefined)?.price
  return {
    ...price,
    ...(addon.billed_price && {
      cents: addon.billed_price.cents,
      contract: addon.billed_price.contract,
    }),
  } as Plan['price']
}
