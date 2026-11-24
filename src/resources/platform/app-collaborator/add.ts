import type {Collaborator, TeamAppCollaborator} from '@heroku/types/3.sdk'

import type {ResourceCtx} from '../../../core/extend-resource.js'

import {withSignal} from '../../../core/with-signal.js'
import {isTeamOwned} from '../app/index.js'
import {type AppCollaboratorOptions, normalizePermissions} from './index.js'

export type AddCollaboratorOptions = AppCollaboratorOptions & {
  permissions?: string[]
}

/**
 * Add a collaborator to an app.
 */
export async function add(
  ctx: Pick<ResourceCtx, 'platform'>,
  appIdentity: string,
  email: string,
  options: AddCollaboratorOptions = {},
): Promise<Collaborator | TeamAppCollaborator> {
  const {permissions, signal} = options
  signal?.throwIfAborted()

  const platform = withSignal(ctx.platform, signal)
  const app = await platform.app.info(appIdentity)

  if (isTeamOwned(app)) {
    if (permissions) {
      return platform.teamAppCollaborator.create(appIdentity, {
        permissions: normalizePermissions(permissions),
        user: email,
      })
    }

    return platform.teamAppCollaborator.create(appIdentity, {user: email})
  }

  return platform.collaborator.create(appIdentity, {user: email})
}
