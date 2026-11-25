import type {App, TeamAppPermission, TeamMember} from '@heroku/types/3.sdk'

import {HerokuApiError} from '@heroku/heroku-fetch'
import {
  describe, expect, it, vi,
} from 'vitest'

import type {ResourceCtx} from '../../../core/extend-resource.js'

import {list} from './list.js'

function buildCtx(opts: {
  appInfo?: ReturnType<typeof vi.fn>,
  listCollaborators?: ReturnType<typeof vi.fn>,
  listTeamMembers?: ReturnType<typeof vi.fn>,
  listTeamPermissions?: ReturnType<typeof vi.fn>,
}): Pick<ResourceCtx, 'platform'> {
  const platform: Record<string, unknown> = {
    app: {info: opts.appInfo ?? vi.fn()},
    collaborator: {list: opts.listCollaborators ?? vi.fn()},
    teamAppPermission: {list: opts.listTeamPermissions ?? vi.fn()},
    teamMember: {list: opts.listTeamMembers ?? vi.fn()},
  }

  platform.withOptions = vi.fn(() => platform)

  return {platform: platform as never}
}

function personalApp(): App {
  return {owner: {email: 'person@example.com', id: 'personal-owner-id'}, team: null} as App
}

function teamApp(): App {
  return {owner: {email: 'my-team@herokumanager.com', id: 'team-owner-id'}, team: {name: 'my-team'}} as App
}

function member(email: string, role: TeamMember['role']): TeamMember {
  return {email, role} as TeamMember
}

describe('list', () => {
  it('returns the collaborator list for a personal app, with no team lookups', async () => {
    const collaborators = [{id: 'collaborator-1', user: {email: 'member@example.com'}}]
    const listTeamMembers = vi.fn()
    const listTeamPermissions = vi.fn()
    const ctx = buildCtx({
      appInfo: vi.fn().mockResolvedValue(personalApp()),
      listCollaborators: vi.fn().mockResolvedValue(collaborators),
      listTeamMembers,
      listTeamPermissions,
    })

    const result = await list(ctx, 'personal-app')

    expect(result).toBe(collaborators)
    expect(listTeamMembers).not.toHaveBeenCalled()
    expect(listTeamPermissions).not.toHaveBeenCalled()
  })

  it('merges team admins into the list, replacing any matching explicit collaborator entry', async () => {
    const collaborators = [
      {id: 'collaborator-1', user: {email: 'admin@example.com'}},
      {id: 'collaborator-2', user: {email: 'member@example.com'}},
    ]
    const permissions: TeamAppPermission[] = [{name: 'deploy'}, {name: 'view'}]
    const ctx = buildCtx({
      appInfo: vi.fn().mockResolvedValue(teamApp()),
      listCollaborators: vi.fn().mockResolvedValue(collaborators),
      listTeamMembers: vi.fn().mockResolvedValue([member('admin@example.com', 'admin'), member('member@example.com', 'member')]),
      listTeamPermissions: vi.fn().mockResolvedValue(permissions),
    })

    const result = await list(ctx, 'team-app')

    expect(result).toEqual([
      {id: 'collaborator-2', user: {email: 'member@example.com'}},
      {permissions, role: 'admin', user: {email: 'admin@example.com'}},
    ])
  })

  it('falls back to the plain collaborator list on a 403 from the team lookups', async () => {
    const collaborators = [{id: 'collaborator-1', user: {email: 'member@example.com'}}]
    const forbidden = new HerokuApiError('Forbidden', 403)
    const ctx = buildCtx({
      appInfo: vi.fn().mockResolvedValue(teamApp()),
      listCollaborators: vi.fn().mockResolvedValue(collaborators),
      listTeamMembers: vi.fn().mockRejectedValue(forbidden),
    })

    const result = await list(ctx, 'team-app')

    expect(result).toBe(collaborators)
  })

  it('rethrows a non-403 error from the team lookups', async () => {
    const collaborators = [{id: 'collaborator-1', user: {email: 'member@example.com'}}]
    const error = new Error('unexpected failure')
    const ctx = buildCtx({
      appInfo: vi.fn().mockResolvedValue(teamApp()),
      listCollaborators: vi.fn().mockResolvedValue(collaborators),
      listTeamMembers: vi.fn().mockRejectedValue(error),
    })

    await expect(list(ctx, 'team-app')).rejects.toBe(error)
  })

  it('throws if signal is aborted', async () => {
    const ctx = buildCtx({})
    const controller = new AbortController()
    controller.abort()

    await expect(list(ctx, 'app', {signal: controller.signal})).rejects.toThrow()
  })

  it('binds the signal to the platform client', async () => {
    const controller = new AbortController()
    const collaborators = [{id: 'collaborator-1', user: {email: 'member@example.com'}}]
    const ctx = buildCtx({
      appInfo: vi.fn().mockResolvedValue(personalApp()),
      listCollaborators: vi.fn().mockResolvedValue(collaborators),
    })

    await list(ctx, 'app', {signal: controller.signal})

    expect(ctx.platform.withOptions).toHaveBeenCalledWith({signal: controller.signal})
  })
})
