import type {AddOrInviteOptions} from './add-or-invite.js'
import type {ListWithInvitationsOptions} from './list-with-invitations.js'

import {extendResource} from '../../../core/extend-resource.js'
import {addOrInvite} from './add-or-invite.js'
import {listWithInvitations} from './list-with-invitations.js'

export {
  addOrInvite,
  type AddOrInviteOptions,
  type AddOrInviteResult,
  type BeforeMutation,
} from './add-or-invite.js'
export {
  listWithInvitations,
  type ListWithInvitationsOptions,
  type TeamMemberWithStatus,
} from './list-with-invitations.js'

export const teamMemberExtensions = extendResource('platform', 'teamMember', ctx => ({
  addOrInvite: (
    teamIdentity: string,
    email: string,
    role: string,
    options?: AddOrInviteOptions,
  ) => addOrInvite(ctx, teamIdentity, email, role, options),
  listWithInvitations: (teamIdentity: string, options?: ListWithInvitationsOptions) =>
    listWithInvitations(ctx, teamIdentity, options),
}))
