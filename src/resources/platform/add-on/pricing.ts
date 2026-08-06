import type {Plan} from '@heroku/types/3.sdk'

/**
 * 30-day month assumption used to convert monthly pricing to an
 * effective hourly rate. Heroku's documented dyno/add-on pricing
 * uses this convention, so consumers displaying "max $X/month
 * (~$Y/hour)" should compute hourly the same way.
 */
const HOURS_PER_MONTH = 24 * 30

/**
 * How a plan is priced, classified once so every consumer agrees. The
 * classification — not the raw `cents`/`contract`/`metered` fields — is what
 * a caller should branch on to decide how to present a plan:
 *
 * - `'contract'` — negotiated outside monthly add-on billing. `cents` is not a
 *   meaningful price and may be absent.
 * - `'metered'`  — billed per use. A flat `cents` (often `0`) does NOT reflect
 *   real cost; per-use rates live on the plan's meters (fetched separately).
 * - `'free'`     — a flat plan that genuinely costs nothing (`cents === 0`).
 * - `'flat'`     — a fixed recurring price of `cents` per `unit`.
 *
 * The precedence (contract, then metered, then free, then flat) matches the
 * Heroku CLI's long-standing production behavior: a contract- or metered-billed
 * plan is reported as such even when its flat `cents` reads `0`, so a `cents: 0`
 * metered/contract plan is never mistaken for free.
 */
export type PlanPriceKind = 'contract' | 'flat' | 'free' | 'metered'

export type PlanPriceBreakdown = {
  /**
   * Raw price as reported by the API, in cents. `undefined` for a contract
   * plan that reports no `cents` (the price is negotiated elsewhere).
   */
  cents: number | undefined
  /** True when the price is negotiated outside monthly add-on billing */
  contract: boolean
  /**
   * The price classification. Branch on this rather than re-deriving it from
   * `cents`/`contract`/`metered` at each call site — that re-derivation is the
   * source of the "0 cents ⇒ free" bug this field exists to prevent.
   */
  kind: PlanPriceKind
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
 * Returns `undefined` only when the plan carries no pricing signal at
 * all — no `price`, and no `cents`/`contract`/`metered` to classify
 * from. A contract- or metered-billed plan still classifies (its flag
 * is the signal) even when `cents` is absent. `Plan.price` is typed as
 * optional in `@heroku/types`, and consumers occasionally receive
 * partial responses depending on the Accept variant.
 *
 * `perMonthCents` and `perHourCents` are populated only for a flat or
 * free plan on a `'month'`/`'hour'` cadence; they are `undefined` for
 * metered/contract plans and for unknown units, so callers omit those
 * parts of their label rather than show fabricated numbers.
 *
 * @param plan The plan to break down. Pass the whole `Plan` rather
 *   than just `plan.price` so the helper can pick up future fields
 *   without API churn at call sites.
 */
export function priceForPlan(plan: Plan): PlanPriceBreakdown | undefined {
  const {price} = plan
  if (!price) return undefined

  const contract = Boolean(price.contract)
  const metered = Boolean(price.metered)
  const hasCents = typeof price.cents === 'number'

  // A plan with no `cents` and no contract/metered flag carries no usable
  // pricing signal at all — treat it as unknown (undefined) rather than
  // guessing. Contract/metered plans, by contrast, are fully classifiable
  // without a `cents` value: the flag IS the price signal.
  if (!hasCents && !contract && !metered) return undefined

  const cents = hasCents ? (price.cents as number) : undefined
  const unit = price.unit ?? ''

  // Precedence matches the CLI's production formatter: contract and metered
  // win over the raw cents, so a `cents: 0` contract/metered plan is never
  // classified as free. `free` is a flat plan that genuinely costs nothing.
  let kind: PlanPriceKind
  if (contract) kind = 'contract'
  else if (metered) kind = 'metered'
  else if (cents === 0) kind = 'free'
  else kind = 'flat'

  // Per-month / per-hour equivalents are only meaningful for a flat recurring
  // price on a known cadence. Metered/contract plans (and unknown units) leave
  // them undefined so callers omit those labels instead of rendering
  // fabricated numbers.
  let perMonthCents: number | undefined
  let perHourCents: number | undefined
  if ((kind === 'flat' || kind === 'free') && cents !== undefined) {
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
        perMonthCents = undefined
        perHourCents = undefined
      }
    }
  }

  return {
    cents,
    contract,
    kind,
    metered,
    perHourCents,
    perMonthCents,
    unit,
  }
}

export type FormatPlanPriceLabelOptions = {
  /** ISO 4217 currency code passed to `Intl.NumberFormat`. Default: `'USD'`. */
  currency?: string
  /** BCP 47 locale tag passed to `Intl.NumberFormat`. Default: `'en-US'`. */
  locale?: string
}

/**
 * Format a plan's price as a human-readable suffix:
 * `"$0.007 / hour (Max $5/month)"`. Returns an empty string when the
 * plan has no displayable price (no `price.cents`, an unknown unit,
 * a metered plan, or a contract-priced plan) — callers can compose
 * their final label as `${name}${suffix ? ' - ' + suffix : ''}`
 * without per-call defensive checks.
 *
 * Locale and currency default to `'en-US'` / `'USD'`. Pass options
 * to override.
 *
 * @example
 * ```ts
 * const suffix = formatPlanPriceLabel(plan);
 * const label = suffix ? `${plan.human_name} - ${suffix}` : plan.human_name;
 * ```
 */
export function formatPlanPriceLabel(
  plan: Plan,
  options: FormatPlanPriceLabelOptions = {},
): string {
  const breakdown = priceForPlan(plan)
  if (!breakdown) return ''
  // Metered and contract-priced plans don't have a meaningful flat
  // monthly/hourly label — the consumer should describe them
  // differently (e.g. "metered", "contract pricing"). Returning an
  // empty string here lets the caller fall back to the plan name.
  if (breakdown.metered || breakdown.contract) return ''
  if (breakdown.perMonthCents === undefined || breakdown.perHourCents === undefined) return ''

  const {currency = 'USD', locale = 'en-US'} = options
  const formatter = new Intl.NumberFormat(locale, {currency, style: 'currency'})
  const perHour = formatter.format(breakdown.perHourCents / 100)
  const perMonth = formatter.format(breakdown.perMonthCents / 100)
  return `${perHour} / hour (Max ${perMonth}/month)`
}
