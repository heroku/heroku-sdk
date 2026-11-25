import type {App} from '@heroku/types/3.sdk'

import {
  describe, expect, it, vi,
} from 'vitest'

import type {ResourceCtx} from '../../../core/extend-resource.js'

import {NotATeamAppError, update} from './update.js'

function buildCtx(opts: {
  appInfo?: ReturnType<typeof vi.fn>,
  updateCollaborator?: ReturnType<typeof vi.fn>,
}): Pick<ResourceCtx, 'platform'> {
  const platform: Record<string, unknown> = {
    app: {info: opts.appInfo ?? vi.fn()},
    teamAppCollaborator: {update: opts.updateCollaborator ?? vi.fn()},
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

describe('update', () => {
  it('updates a team-app collaborator, always including view in the permission set', async () => {
    const updated = {id: 'collaborator-1'}
    const updateCollaborator = vi.fn().mockResolvedValue(updated)
    const ctx = buildCtx({
      appInfo: vi.fn().mockResolvedValue(teamApp()),
      updateCollaborator,
    })

    const result = await update(ctx, 'team-app', 'member@example.com', {permissions: ['deploy']})

    expect(updateCollaborator).toHaveBeenCalledExactlyOnceWith('team-app', 'member@example.com', {
      permissions: ['deploy', 'view'],
    })
    expect(result).toBe(updated)
  })

  it('throws NotATeamAppError for a personal app, without calling update', async () => {
    const updateCollaborator = vi.fn()
    const ctx = buildCtx({
      appInfo: vi.fn().mockResolvedValue(personalApp()),
      updateCollaborator,
    })

    await expect(update(ctx, 'personal-app', 'member@example.com', {permissions: ['deploy']})).rejects.toThrow(NotATeamAppError)
    expect(updateCollaborator).not.toHaveBeenCalled()
  })

  it('throws if signal is aborted', async () => {
    const ctx = buildCtx({})
    const controller = new AbortController()
    controller.abort()

    await expect(update(ctx, 'app', 'member@example.com', {permissions: ['deploy']}, {signal: controller.signal})).rejects.toThrow()
  })

  it('binds the signal to the platform client', async () => {
    const controller = new AbortController()
    const ctx = buildCtx({
      appInfo: vi.fn().mockResolvedValue(teamApp()),
      updateCollaborator: vi.fn().mockResolvedValue({id: 'collaborator-1'}),
    })

    await update(ctx, 'team-app', 'member@example.com', {permissions: ['deploy']}, {signal: controller.signal})

    expect(ctx.platform.withOptions).toHaveBeenCalledExactlyOnceWith({signal: controller.signal})
  })
})
