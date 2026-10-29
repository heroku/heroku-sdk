import type {Account, Collaborator} from '@heroku/types/3.sdk'

import type {ResourceCtx} from '../../../core/extend-resource.js'
import type {AccountWithDelinquency} from '../account.js'

import {withSignal} from '../../../core/with-signal.js'
import {getAccountWithDelinquency} from '../account.js'

export type BeforeRemove = (details: AccountWithDelinquency) => Promise<void> | void

export type RemoveSelfOptions = {
  beforeRemove?: BeforeRemove
  signal?: AbortSignal
}

/** Remove the authenticated account from an app's collaborator list. */
export async function removeSelf(
  ctx: Pick<ResourceCtx, 'platform'>,
  appIdentity: string,
  options: RemoveSelfOptions = {},
): Promise<Collaborator> {
  options.signal?.throwIfAborted()

  let account: Account
  if (options.beforeRemove) {
    const details = await getAccountWithDelinquency(ctx, options.signal ? {signal: options.signal} : {})
    options.signal?.throwIfAborted()
    await options.beforeRemove(details)
    options.signal?.throwIfAborted()
    account = details.account
  } else {
    const platform = withSignal(ctx.platform, options.signal)
    account = await platform.account.info()
    options.signal?.throwIfAborted()
  }

  // Keep the email raw: the generated route encodes path parameters once.
  return withSignal(ctx.platform, options.signal).collaborator.delete(appIdentity, account.email)
}
