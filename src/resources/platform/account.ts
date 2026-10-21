import type {Account, AccountDelinquency} from '@heroku/types/3.sdk'

import createDebug from 'debug'

import type {ResourceCtx} from '../../core/extend-resource.js'

import {extendResource} from '../../core/extend-resource.js'

const debug = createDebug('heroku:sdk:resources:account')

export type GetAccountWithDelinquencyOptions = {
  signal?: AbortSignal
}

export type AccountWithDelinquency = {
  account: Account
  delinquency: AccountDelinquency | null
}

/**
 * Fetch the authenticated account together with its delinquency status.
 *
 * Runs the two reads concurrently. The account lookup hard-fails — there is no
 * result without it. The delinquency lookup soft-fails to `null`: a hiccup on
 * that secondary call must not sink an otherwise-successful account fetch (it
 * backs commands like `whoami`). Callers decide whether and how to surface a
 * warning from `delinquency` — `formatDelinquencyWarning` renders the sentence.
 */
export async function getAccountWithDelinquency(
  ctx: Pick<ResourceCtx, 'platform'>,
  options: GetAccountWithDelinquencyOptions = {},
): Promise<AccountWithDelinquency> {
  options.signal?.throwIfAborted()
  const platform = options.signal
    ? ctx.platform.withOptions({signal: options.signal})
    : ctx.platform

  const [account, delinquency] = await Promise.all([
    platform.account.info(),
    platform.accountDelinquency.info().catch((error: unknown): null => {
      // Soft-fail a secondary-call hiccup to null, but rethrow a cancellation:
      // if the caller aborted, returning null would misreport a delinquent
      // account as current. Anything else is logged and swallowed.
      if (options.signal?.aborted) throw error
      debug('account delinquency lookup failed; treating as not delinquent: %O', error)
      return null
    }),
  ])

  return {account, delinquency}
}

export const accountExtensions = extendResource('platform', 'account', ctx => ({
  getWithDelinquency: (options?: GetAccountWithDelinquencyOptions) =>
    getAccountWithDelinquency(ctx, options),
}))
