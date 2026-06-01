import type {Plan} from '@heroku/types/3.sdk'

/**
 * 30-day month assumption used to convert monthly pricing to an
 * effective hourly rate. Heroku's documented dyno/add-on pricing
 * uses this convention, so consumers displaying "max $X/month
 * (~$Y/hour)" should compute hourly the same way.
 */
const HOURS_PER_MONTH = 24 * 30

export type PlanPriceBreakdown = {
  /** raw price as reported by the API, in cents */
  cents: number
  /** True when the price is negotiated outside monthly add-on billing */
  contract: boolean
  /** True when the price is billed per use rather than at a fixed cadence */
  metered: boolean
  /**
   * Equivalent hourly cost in cents (may be fractional). Equal to
   * `cents` when `unit` is `'hour'`; computed as `cents /
   * HOURS_PER_MONTH` when `unit` is `'month'`. `undefined` when the
   * unit is anything else — callers can omit the per-hour label
   * rather than render misleading numbers.
   */
  perHourCents: number | undefined
  /**
   * Equivalent monthly cost in cents. Equal to `cents` when `unit` is
   * `'month'`; computed as `cents * HOURS_PER_MONTH` when `unit` is
   * `'hour'`. `undefined` when the unit is anything else.
   */
  perMonthCents: number | undefined
  /** unit reported by the API (e.g. `'month'`, `'hour'`) */
  unit: string
}

/**
 * Break a plan's price down into monthly- and hourly-equivalent
 * cents, normalizing across the API's billing unit. Consumers that
 * display "max $X/month (~$Y/hour)" labels should call this rather
 * than dividing `cents` by hours themselves; centralizing the math
 * keeps the 30-day-month assumption (Heroku's documented convention)
 * in one place.
 *
 * Returns `undefined` if the plan has no usable `price.cents` value.
 * `Plan.price` is typed as optional in `@heroku/types`, and consumers
 * occasionally receive partial responses depending on the Accept
 * variant.
 *
 * `perMonthCents` and `perHourCents` are themselves `undefined` when
 * the API reports a unit other than `'month'` or `'hour'` — callers
 * should omit those parts of their label rather than show fabricated
 * numbers.
 *
 * @param plan The plan to break down. Pass the whole `Plan` rather
 *   than just `plan.price` so the helper can pick up future fields
 *   without API churn at call sites.
 */
export function priceForPlan(plan: Plan): PlanPriceBreakdown | undefined {
  const {price} = plan
  if (!price || typeof price.cents !== 'number') return undefined

  const {cents} = price
  const unit = price.unit ?? ''

  let perMonthCents: number | undefined
  let perHourCents: number | undefined
  switch (unit) {
    case 'hour': {
      perHourCents = cents
      perMonthCents = cents * HOURS_PER_MONTH
      break
    }

    case 'month': {
      perMonthCents = cents
      perHourCents = cents / HOURS_PER_MONTH
      break
    }

    default: {
      // Unknown billing unit — leave per-month / per-hour undefined
      // so callers can omit those labels instead of rendering
      // fabricated numbers.
      perMonthCents = undefined
      perHourCents = undefined
    }
  }

  return {
    cents,
    contract: Boolean(price.contract),
    metered: Boolean(price.metered),
    perHourCents,
    perMonthCents,
    unit,
  }
}
