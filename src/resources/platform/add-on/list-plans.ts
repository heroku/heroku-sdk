import type {Plan} from '@heroku/types/3.sdk'

import type {ResourceCtx} from '../../../core/extend-resource.js'
import type {AddOnOptions} from './types.js'

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

function byPriceCentsAsc(a: Plan, b: Plan): number {
  return sortableCents(a) - sortableCents(b)
}

function sortableCents(plan: Plan): number {
  const cents = plan.price?.cents
  return typeof cents === 'number' ? cents : Number.MAX_SAFE_INTEGER
}
