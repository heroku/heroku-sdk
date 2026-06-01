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
  /**
   * Equivalent hourly cost in cents (may be fractional). Equal to
   * `cents` when `unit` is `'hour'`; computed as `cents /
   * HOURS_PER_MONTH` when `unit` is `'month'`. Returns `cents` for
   * unknown units (best-effort).
   */
  perHourCents: number
  /**
   * Equivalent monthly cost in cents. Equal to `cents` when `unit` is
   * `'month'`; computed as `cents * HOURS_PER_MONTH` when `unit` is
   * `'hour'`. Returns `cents` for unknown units (best-effort).
   */
  perMonthCents: number
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
 * Returns `undefined` if the plan has no price (defensive — the API
 * shape declares `price` as required, but consumers occasionally
 * receive partial responses depending on the Accept variant).
 *
 * @param plan The plan to break down. Pass the whole `Plan` rather
 *   than just `plan.price` so the helper can pick up future fields
 *   (e.g. metered/contract metadata) without API churn at call sites.
 */
export function priceForPlan(plan: Plan): PlanPriceBreakdown | undefined {
  const {price} = plan
  if (!price || typeof price.cents !== 'number') return undefined

  const {cents} = price
  const unit = price.unit ?? ''

  let perMonthCents: number
  let perHourCents: number
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
      // Unknown billing unit — fall back to the raw cents on both
      // axes so callers at least get a non-zero value to display.
      perMonthCents = cents
      perHourCents = cents
    }
  }

  return {
    cents,
    contract: Boolean(price.contract),
    perHourCents,
    perMonthCents,
    unit,
  }
}
