import type {Team, TeamDelinquency} from '@heroku/types/3.sdk'

import createDebug from 'debug'

import type {ResourceCtx} from '../../core/extend-resource.js'

import {extendResource} from '../../core/extend-resource.js'

const debug = createDebug('heroku:sdk:resources:team')

export type GetTeamWithDelinquencyOptions = {
  signal?: AbortSignal
}

export type TeamWithDelinquency = {
  delinquency: null | TeamDelinquency
  team: Team
}

/**
 * Fetch a team together with its delinquency status.
 *
 * Runs the two reads concurrently. The team lookup hard-fails — there is no
 * result without it. The delinquency lookup soft-fails to `null`: a hiccup on
 * that secondary call must not sink an otherwise-successful team fetch. Callers
 * decide whether and how to surface a warning from `delinquency` —
 * `formatDelinquencyWarning` renders the sentence.
 */
export async function getTeamWithDelinquency(
  ctx: Pick<ResourceCtx, 'platform'>,
  teamIdentity: string,
  options: GetTeamWithDelinquencyOptions = {},
): Promise<TeamWithDelinquency> {
  options.signal?.throwIfAborted()
  const platform = options.signal
    ? ctx.platform.withOptions({signal: options.signal})
    : ctx.platform

  const [team, delinquency] = await Promise.all([
    platform.team.info(teamIdentity),
    platform.teamDelinquency.info(teamIdentity).catch((error: unknown): null => {
      // Soft-fail a secondary-call hiccup to null, but rethrow a cancellation:
      // if the caller aborted, returning null would misreport a delinquent team
      // as current. Anything else is logged and swallowed.
      if (options.signal?.aborted) throw error
      debug('team delinquency lookup failed; treating as not delinquent: %O', error)
      return null
    }),
  ])

  return {delinquency, team}
}

export const teamExtensions = extendResource('platform', 'team', ctx => ({
  getWithDelinquency: (teamIdentity: string, options?: GetTeamWithDelinquencyOptions) =>
    getTeamWithDelinquency(ctx, teamIdentity, options),
}))
