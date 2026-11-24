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
 *
 * If the app is team-owned and `options.permissions` is provided,
 * the collaborator is added with the specified permissions.
 * Otherwise, the collaborator is added without permissions.
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

  if (isTeamOwned(app) && permissions) {
    return platform.teamAppCollaborator.create(appIdentity, {
      permissions: normalizePermissions(permissions),
      user: email,
    })
  }

  return platform.collaborator.create(appIdentity, {user: email})
}
