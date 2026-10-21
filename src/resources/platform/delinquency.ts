/**
 * Shared shape of the platform's delinquency payloads. `AccountDelinquency`
 * and `TeamDelinquency` are structurally identical — each carries the two
 * scheduled timestamps (or `null` when nothing is scheduled) — so a single
 * formatter serves both.
 */
export interface DelinquencySchedule {
  scheduled_deletion_time: null | string
  scheduled_suspension_time: null | string
}

/** The kind of resource a delinquency applies to; used in the message text. */
export type DelinquencyResource = 'account' | 'team'

/**
 * Build the user-facing delinquency warning sentence for a resource, or
 * `undefined` when nothing should be surfaced. Pure: it only formats the
 * message — emitting it (to stderr, a log, a UI) is the caller's concern.
 *
 * Mirrors the three cases the Heroku CLI has historically shown:
 *  - a suspension still in the future → when we'll suspend it;
 *  - a suspension already in the past with a deletion scheduled → when we
 *    suspended it and when we'll delete it;
 *  - a deletion with no suspension → when we'll delete it.
 *
 * A suspension already in the past with no deletion scheduled yields no message
 * (the suspension has happened and there is nothing further to warn about), as
 * does a payload with neither timestamp set.
 *
 * `now` is injectable so the future-vs-past comparison is testable; it defaults
 * to the wall clock.
 */
export function formatDelinquencyWarning(
  resource: DelinquencyResource,
  delinquency: DelinquencySchedule | null | undefined,
  now: number = Date.now(),
): string | undefined {
  const suspension = parseTime(delinquency?.scheduled_suspension_time)
  const deletion = parseTime(delinquency?.scheduled_deletion_time)
  if (!suspension && !deletion) return undefined

  if (suspension) {
    if (suspension > now) {
      return `This ${resource} is delinquent with payment and we'll suspend it on ${new Date(suspension).toString()}.`
    }

    if (deletion) {
      return `This ${resource} is delinquent with payment and we suspended it on ${new Date(suspension).toString()}.`
        + ` If the ${resource} is still delinquent, we'll delete it on ${new Date(deletion).toString()}.`
    }

    return undefined
  }

  if (deletion) {
    return `This ${resource} is delinquent with payment and we'll delete it on ${new Date(deletion).toString()}.`
  }

  return undefined
}

/**
 * Parse an ISO timestamp to epoch ms, or `undefined` when it is absent or
 * unparseable. A `0`/`NaN` result is treated as absent so it never trips the
 * truthiness checks above.
 */
function parseTime(time: null | string | undefined): number | undefined {
  if (!time) return undefined
  const ms = Date.parse(time)
  return Number.isNaN(ms) || ms === 0 ? undefined : ms
}
