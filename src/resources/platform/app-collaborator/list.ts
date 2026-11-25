import type {Collaborator, TeamAppPermission} from '@heroku/types/3.sdk'

import {HerokuApiError} from '@heroku/heroku-fetch'

import type {ResourceCtx} from '../../../core/extend-resource.js'
import type {AppCollaboratorOptions} from './index.js'

import {withSignal} from '../../../core/with-signal.js'
import {getOwner, isTeamOwned} from '../app/index.js'

const FORBIDDEN_STATUS_CODE = 403

export type AdminCollaborator = {
  permissions: TeamAppPermission[],
  role: 'admin',
  user: {email: string},
}

/**
 * List an app's collaborators.
 *
 * For a team-owned app, admins have implicit access through their team role
 * rather than an explicit collaborator record, so they're merged into the
 * returned list (with the team's full permission set) in place of any
 * matching explicit collaborator entry. If the caller lacks access to the
 * team's members or permissions (403), the merge is skipped and the plain
 * collaborator list is returned.
 */
export async function list(
  ctx: Pick<ResourceCtx, 'platform'>,
  appIdentity: string,
  options: AppCollaboratorOptions = {},
): Promise<Array<AdminCollaborator | Collaborator>> {
  const {signal} = options
  signal?.throwIfAborted()

  const platform = withSignal(ctx.platform, signal)
  const app = await platform.app.info(appIdentity)

  const collaborators = await platform.collaborator.list(appIdentity)

  if (!isTeamOwned(app)) {
    return collaborators
  }

  const teamName = getOwner(app)

  try {
    const [members, permissions] = await Promise.all([
      platform.teamMember.list(teamName),
      platform.teamAppPermission.list(),
    ])

    const admins: AdminCollaborator[] = members
      .filter(member => member.role === 'admin')
      .map(admin => ({
        permissions,
        role: 'admin',
        user: {email: admin.email},
      }))

    const nonAdminCollaborators = collaborators.filter(collaborator => !admins.some(admin => admin.user.email === collaborator.user.email))

    return [...nonAdminCollaborators, ...admins]
  } catch (error) {
    if (error instanceof HerokuApiError && error.statusCode === FORBIDDEN_STATUS_CODE) {
      return collaborators
    }

    throw error
  }
}
