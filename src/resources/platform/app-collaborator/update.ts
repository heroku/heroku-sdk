import type {App, TeamAppCollaborator, TeamAppCollaboratorUpdateOpts} from '@heroku/types/3.sdk'

import type {ResourceCtx} from '../../../core/extend-resource.js'
import type {AppCollaboratorOptions} from './index.js'

import {withSignal} from '../../../core/with-signal.js'
import {isTeamOwned} from '../app/index.js'
import {normalizePermissions} from './index.js'

export class NotATeamAppError extends Error {
  public readonly id = 'not_a_team_app'

  constructor(public readonly app: App) {
    super('This operation is for team apps only.')
    this.name = 'NotATeamAppError'
  }
}

/**
 * Update a team-app collaborator's permissions.
 * @throws {NotATeamAppError} if the app is not team-owned.
 */
export async function update(
  ctx: Pick<ResourceCtx, 'platform'>,
  appIdentity: string,
  email: string,
  body: TeamAppCollaboratorUpdateOpts,
  options: AppCollaboratorOptions = {},
): Promise<TeamAppCollaborator> {
  const {signal} = options
  signal?.throwIfAborted()

  const platform = withSignal(ctx.platform, signal)
  const app = await platform.app.info(appIdentity)

  if (!isTeamOwned(app)) {
    throw new NotATeamAppError(app)
  }

  return platform.teamAppCollaborator.update(appIdentity, email, {
    permissions: normalizePermissions(body.permissions),
  })
}
