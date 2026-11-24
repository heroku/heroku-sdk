import type {TeamApp, TeamInvitation, TeamMember} from '@heroku/types/3.sdk'

import {HerokuSDK} from '@heroku/sdk'
import {
  type AddOrInviteOptions,
  type AddOrInviteResult,
  type BeforeMutation,
  type ListWithInvitationsOptions,
  teamMemberExtensions,
  type TeamMemberWithStatus,
} from '@heroku/sdk/extensions/platform'
import {
  addOrInvite,
  listWithInvitations,
} from '@heroku/sdk/resources/platform/team-member'

const sdk = new HerokuSDK({extensions: [teamMemberExtensions]})

const options: ListWithInvitationsOptions = {signal: new AbortController().signal}
const listed: Promise<TeamMemberWithStatus[]> = sdk.platform.teamMember.listWithInvitations('example-team', options)
const standaloneListed: Promise<TeamMemberWithStatus[]> = listWithInvitations({} as Parameters<typeof listWithInvitations>[0], 'example-team', options)
function beforeMutation({kind}: Parameters<BeforeMutation>[0]): void {
  if (kind !== 'invitation' && kind !== 'member') {
    const unexpectedKind: never = kind
    throw new Error(`Unexpected mutation kind: ${unexpectedKind}`)
  }
}

const addOptions: AddOrInviteOptions = {
  beforeMutation,
  signal: new AbortController().signal,
}
const standaloneMutationKind: BeforeMutation = beforeMutation

const addResult: Promise<AddOrInviteResult> = sdk.platform.teamMember.addOrInvite('example-team', 'member@example.com', 'a-custom-role', addOptions)
const standaloneAddResult: Promise<AddOrInviteResult> = addOrInvite({} as Parameters<typeof addOrInvite>[0], 'example-team', 'member@example.com', 'a-custom-role', addOptions)
const result: AddOrInviteResult = await addResult
export const resolvedAddResult: TeamInvitation | TeamMember = (() => {
  if (result.kind === 'invitation') {
    const {invitation} = result
    return invitation
  }

  const {member} = result
  return member
})()

// Adding the extension must preserve generated teamMember routes.
export const memberList: ReturnType<typeof sdk.platform.teamMember.list> = sdk.platform.teamMember.list('example-team')
export const memberListByMember: ReturnType<typeof sdk.platform.teamMember.listByMember>
  = sdk.platform.teamMember.listByMember('example-team', 'member@example.com')
export const memberCreateOrUpdate: ReturnType<typeof sdk.platform.teamMember.createOrUpdate>
  = sdk.platform.teamMember.createOrUpdate('example-team', {email: 'member@example.com', role: 'admin'})
export const memberCreate: ReturnType<typeof sdk.platform.teamMember.create>
  = sdk.platform.teamMember.create('example-team', {email: 'member@example.com', role: 'admin'})
export const memberUpdate: ReturnType<typeof sdk.platform.teamMember.update> = sdk.platform.teamMember.update('example-team', {
  email: 'member@example.com',
  role: 'admin',
})
export const memberDelete: ReturnType<typeof sdk.platform.teamMember.delete>
  = sdk.platform.teamMember.delete('example-team', 'member@example.com')

export const generatedMember: Promise<TeamMember[]> = memberList
export const generatedMemberApps: Promise<TeamApp[]> = memberListByMember
export {
  listed, standaloneAddResult, standaloneListed, standaloneMutationKind,
}
