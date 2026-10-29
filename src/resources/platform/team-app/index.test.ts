import {
  describe, expect, it, vi,
} from 'vitest'

import type {ResourceCtx} from '../../../core/extend-resource.js'

import {mergeExtensions} from '../../../core/extensions-proxy.js'
import {appCollaboratorExtensions} from '../app-collaborator/index.js'
import {teamAppExtensions} from './index.js'

describe('teamAppExtensions', () => {
  it('adds joinSelf to the existing teamApp namespace', () => {
    const ctx = {platform: {} as never} as ResourceCtx
    const methods = teamAppExtensions.factory(ctx)

    expect(teamAppExtensions.service).toBe('platform')
    expect(teamAppExtensions.resource).toBe('teamApp')
    expect(typeof methods.joinSelf).toBe('function')
  })

  it('delegates joinSelf with the extension context', async () => {
    const account = {email: 'member+tag@example.com'}
    const created = {user: account}
    const info = vi.fn().mockResolvedValue(account)
    const create = vi.fn().mockResolvedValue(created)
    const ctx = {platform: {account: {info}, teamAppCollaborator: {create}} as never} as ResourceCtx
    const methods = teamAppExtensions.factory(ctx)

    const result = await methods.joinSelf('team-app')

    expect(info).toHaveBeenCalledExactlyOnceWith()
    expect(create).toHaveBeenCalledExactlyOnceWith('team-app', {user: account.email})
    expect(result).toBe(created)
  })

  it('adds membership helpers without replacing generated base APIs', () => {
    const teamInfo = vi.fn()
    const teamTransfer = vi.fn()
    const collaboratorDelete = vi.fn()
    const routes = {
      collaborator: {delete: collaboratorDelete},
      teamApp: {info: teamInfo, transferToTeam: teamTransfer},
    }
    const ctx = {platform: routes as never} as ResourceCtx
    const extended = mergeExtensions(routes, [teamAppExtensions, appCollaboratorExtensions], ctx) as {
      appCollaborator: {removeSelf: unknown}
      collaborator: {delete: typeof collaboratorDelete}
      teamApp: {info: typeof teamInfo; joinSelf: unknown; transferToTeam: typeof teamTransfer}
    }

    expect(typeof extended.teamApp.joinSelf).toBe('function')
    expect(typeof extended.appCollaborator.removeSelf).toBe('function')
    expect(extended.teamApp.info).toBe(teamInfo)
    expect(extended.teamApp.transferToTeam).toBe(teamTransfer)
    expect(extended.collaborator.delete).toBe(collaboratorDelete)
  })
})
