import type {TeamAppCollaborator} from '@heroku/types/3.sdk'

import type {ResourceCtx} from '../../../core/extend-resource.js'

import {withSignal} from '../../../core/with-signal.js'

export type JoinSelfOptions = {
  signal?: AbortSignal
}

/** Add the authenticated account as a collaborator on a team app. */
export async function joinSelf(
  ctx: Pick<ResourceCtx, 'platform'>,
  appIdentity: string,
  options: JoinSelfOptions = {},
): Promise<TeamAppCollaborator> {
  options.signal?.throwIfAborted()
  const platform = withSignal(ctx.platform, options.signal)
  const account = await platform.account.info()
  options.signal?.throwIfAborted()

  return platform.teamAppCollaborator.create(appIdentity, {user: account.email})
}
