/* eslint-disable perfectionist/sort-object-types, perfectionist/sort-objects -- keep discriminant first in result union */
import type {
  Team,
  TeamFeature,
  TeamInvitation,
  TeamInvitationCreateOpts,
  TeamMember,
  TeamMemberCreateOrUpdateOpts,
} from '@heroku/types/3.sdk'

import type {ResourceCtx} from '../../../core/extend-resource.js'

import {combineSignals, withSignal} from '../../../core/with-signal.js'

const TEAM_INVITATIONS_ACCEPT = 'application/vnd.heroku+json; version=3.team-invitations'
const TEAM_INVITATION_FEATURE = 'team-invite-acceptance'

export type BeforeMutation = (details: {kind: 'invitation' | 'member'}) => Promise<void> | void

export type AddOrInviteOptions = {
  beforeMutation?: BeforeMutation
  signal?: AbortSignal
}

export type AddOrInviteResult
  = | {kind: 'invitation', invitation: TeamInvitation}
    | {kind: 'member', member: TeamMember}

/** Add a team member directly or create a pending invitation when enabled. */
// eslint-disable-next-line max-params -- expose the team/email/role plus optional operation options directly
export async function addOrInvite(
  ctx: Pick<ResourceCtx, 'operationSignal' | 'platform'>,
  teamIdentity: string,
  email: string,
  role: string,
  options: AddOrInviteOptions = {},
): Promise<AddOrInviteResult> {
  const signal = combineSignals(ctx.operationSignal, options.signal)
  signal?.throwIfAborted()

  const platform = withSignal(ctx.platform, signal)
  const team: Team = await platform.team.info(teamIdentity)
  signal?.throwIfAborted()

  let invitationEnabled = false
  if (team.type === 'team') {
    const features: TeamFeature[] = await platform.teamFeature.list(teamIdentity)
    signal?.throwIfAborted()
    invitationEnabled = features.some(feature => feature.name === TEAM_INVITATION_FEATURE && feature.enabled)
  }

  const kind: AddOrInviteResult['kind'] = invitationEnabled ? 'invitation' : 'member'
  signal?.throwIfAborted()
  await options.beforeMutation?.({kind})
  signal?.throwIfAborted()

  if (invitationEnabled) {
    // The Platform API validates the role and may reject values unsupported by this route.
    const invitation = await platform.withHeaders({Accept: TEAM_INVITATIONS_ACCEPT})
      .teamInvitation.create(teamIdentity, {email, role: role as TeamInvitationCreateOpts['role']})
    return {kind: 'invitation', invitation}
  }

  // The Platform API validates the role and may reject values unsupported by this route.
  const member = await platform.teamMember.createOrUpdate(teamIdentity, {
    email,
    role: role as TeamMemberCreateOrUpdateOpts['role'],
  })
  return {kind: 'member', member}
}

/* eslint-enable perfectionist/sort-object-types, perfectionist/sort-objects */
