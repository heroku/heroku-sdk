import type {Account, Collaborator, TeamAppCollaborator} from '@heroku/types/3.sdk'

import {HerokuSDK} from '@heroku/sdk'
import {appCollaboratorExtensions, teamAppExtensions} from '@heroku/sdk/extensions/platform'

const sdk = new HerokuSDK({extensions: [teamAppExtensions, appCollaboratorExtensions] as const})

export const joined: Promise<TeamAppCollaborator> = sdk.platform.teamApp.joinSelf('example-app')
export const removed: Promise<Collaborator> = sdk.platform.appCollaborator.removeSelf('example-app', {
  beforeRemove({account, delinquency}) {
    const {email}: Account = account
    const scheduledDeletion = delinquency?.scheduled_deletion_time

    if (!email || scheduledDeletion === null) throw new Error('account is missing required fields')
  },
  signal: new AbortController().signal,
})

// Extension projection must preserve the raw generated teamApp routes.
export const teamAppInfo: ReturnType<typeof sdk.platform.teamApp.info>
  = sdk.platform.teamApp.info('example-app')
export const teamAppTransfer: ReturnType<typeof sdk.platform.teamApp.transferToTeam>
  = sdk.platform.teamApp.transferToTeam('example-app', {owner: 'example-team'})

// The extension-only namespace must not replace the generated collaborator API.
export const collaboratorDelete: ReturnType<typeof sdk.platform.collaborator.delete>
  = sdk.platform.collaborator.delete('example-app', 'member@example.com')

// @ts-expect-error joinSelf only accepts its optional signal.
sdk.platform.teamApp.joinSelf('example-app', {beforeRemove() {}})

sdk.platform.appCollaborator.removeSelf('example-app', {
  // @ts-expect-error removeSelf callback receives account and delinquency details.
  beforeRemove(account: Account) {
    return account
  },
})
