import type {Team, TeamInvitation, TeamMember} from '@heroku/types/3.sdk'

import type {ResourceCtx} from '../../../core/extend-resource.js'

import {combineSignals, withSignal} from '../../../core/with-signal.js'

const TEAM_INVITATIONS_ACCEPT = 'application/vnd.heroku+json; version=3.team-invitations'
const TEAM_INVITATION_FEATURE = 'team-invite-acceptance'

export type ListWithInvitationsOptions = {
  signal?: AbortSignal
}

export type TeamMemberWithStatus = TeamMember & {
  status: '' | 'pending'
}

/** List a team's members together with pending invitations, sorted by email. */
export async function listWithInvitations(
  ctx: Pick<ResourceCtx, 'operationSignal' | 'platform'>,
  teamIdentity: string,
  options: ListWithInvitationsOptions = {},
): Promise<TeamMemberWithStatus[]> {
  const signal = combineSignals(ctx.operationSignal, options.signal)
  signal?.throwIfAborted()

  const platform = withSignal(ctx.platform, signal)
  const team: Team = await platform.team.info(teamIdentity)
  signal?.throwIfAborted()

  let invitations: TeamInvitation[] = []
  if (team.type === 'team') {
    const features = await platform.teamFeature.list(teamIdentity)
    signal?.throwIfAborted()

    if (features.some(feature => feature.name === TEAM_INVITATION_FEATURE && feature.enabled)) {
      invitations = await platform.withHeaders({Accept: TEAM_INVITATIONS_ACCEPT})
        .teamInvitation.list(teamIdentity)
      signal?.throwIfAborted()
    }
  }

  const members = await platform.teamMember.list(teamIdentity)
  signal?.throwIfAborted()

  const memberRows: TeamMemberWithStatus[] = members.map(member => ({...member, status: ''}))
  /* eslint-disable perfectionist/sort-objects, camelcase -- preserve the legacy invitation JSON key order */
  const invitationRows: TeamMemberWithStatus[] = invitations.map(invitation => ({
    email: invitation.user?.email || '',
    role: invitation.role,
    status: 'pending',
    federated: false,
    user: invitation.user,
    two_factor_authentication: false,
    created_at: invitation.created_at || '',
    updated_at: invitation.updated_at || '',
  }))
  /* eslint-enable perfectionist/sort-objects, camelcase */

  return [...memberRows, ...invitationRows].sort((a, b) => a.email.localeCompare(b.email))
}
