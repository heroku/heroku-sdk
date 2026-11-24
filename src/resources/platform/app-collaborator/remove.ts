import type {Collaborator, TeamAppCollaborator} from '@heroku/types/3.sdk'

import type {ResourceCtx} from '../../../core/extend-resource.js'
import type {AppCollaboratorOptions} from './index.js'

import {withSignal} from '../../../core/with-signal.js'
import {isTeamOwned} from '../app/index.js'

/**
 * Remove a collaborator from an app.
 */
export async function remove(
  ctx: Pick<ResourceCtx, 'platform'>,
  appIdentity: string,
  email: string,
  options: AppCollaboratorOptions = {},
): Promise<Collaborator | TeamAppCollaborator> {
  const {signal} = options
  signal?.throwIfAborted()

  const platform = withSignal(ctx.platform, signal)
  const app = await platform.app.info(appIdentity)

  if (isTeamOwned(app)) {
    return platform.teamAppCollaborator.delete(appIdentity, email)
  }

  return platform.collaborator.delete(appIdentity, email)
}
