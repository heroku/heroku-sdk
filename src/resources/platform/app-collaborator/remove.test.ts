import type {App} from '@heroku/types/3.sdk'

import {
  describe, expect, it, vi,
} from 'vitest'

import type {ResourceCtx} from '../../../core/extend-resource.js'

import {remove} from './remove.js'

function buildCtx(opts: {
  appInfo?: ReturnType<typeof vi.fn>,
  deleteCollaborator?: ReturnType<typeof vi.fn>,
  deleteTeamAppCollaborator?: ReturnType<typeof vi.fn>,
}): Pick<ResourceCtx, 'platform'> {
  const platform: Record<string, unknown> = {
    app: {info: opts.appInfo ?? vi.fn()},
    collaborator: {delete: opts.deleteCollaborator ?? vi.fn()},
    teamAppCollaborator: {delete: opts.deleteTeamAppCollaborator ?? vi.fn()},
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

describe('remove', () => {
  it('removes a personal-app collaborator via collaborator.delete', async () => {
    const deleted = {id: 'collaborator-1'}
    const deleteCollaborator = vi.fn().mockResolvedValue(deleted)
    const deleteTeamAppCollaborator = vi.fn()
    const ctx = buildCtx({
      appInfo: vi.fn().mockResolvedValue(personalApp()),
      deleteCollaborator,
      deleteTeamAppCollaborator,
    })

    const result = await remove(ctx, 'personal-app', 'member@example.com')

    expect(deleteCollaborator).toHaveBeenCalledExactlyOnceWith('personal-app', 'member@example.com')
    expect(deleteTeamAppCollaborator).not.toHaveBeenCalled()
    expect(result).toBe(deleted)
  })

  it('removes a team-app collaborator via teamAppCollaborator.delete', async () => {
    const deleted = {id: 'collaborator-1'}
    const deleteTeamAppCollaborator = vi.fn().mockResolvedValue(deleted)
    const deleteCollaborator = vi.fn()
    const ctx = buildCtx({
      appInfo: vi.fn().mockResolvedValue(teamApp()),
      deleteCollaborator,
      deleteTeamAppCollaborator,
    })

    const result = await remove(ctx, 'team-app', 'member@example.com')

    expect(deleteTeamAppCollaborator).toHaveBeenCalledExactlyOnceWith('team-app', 'member@example.com')
    expect(deleteCollaborator).not.toHaveBeenCalled()
    expect(result).toBe(deleted)
  })

  it('throws if signal is aborted', async () => {
    const ctx = buildCtx({})
    const controller = new AbortController()
    controller.abort()

    await expect(remove(ctx, 'app', 'member@example.com', {signal: controller.signal})).rejects.toThrow()
  })

  it('binds the signal to the platform client', async () => {
    const controller = new AbortController()
    const ctx = buildCtx({
      appInfo: vi.fn().mockResolvedValue(personalApp()),
      deleteCollaborator: vi.fn().mockResolvedValue({id: 'collaborator-1'}),
    })

    await remove(ctx, 'app', 'member@example.com', {signal: controller.signal})

    expect(ctx.platform.withOptions).toHaveBeenCalledExactlyOnceWith({signal: controller.signal})
  })
})
