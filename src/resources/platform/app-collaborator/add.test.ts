import type {App} from '@heroku/types/3.sdk'

import {
  describe, expect, it, vi,
} from 'vitest'

import type {ResourceCtx} from '../../../core/extend-resource.js'

import {add} from './add.js'

function buildCtx(opts: {
  appInfo?: ReturnType<typeof vi.fn>,
  createCollaborator?: ReturnType<typeof vi.fn>,
  createTeamAppCollaborator?: ReturnType<typeof vi.fn>,
}): Pick<ResourceCtx, 'platform'> {
  const platform: Record<string, unknown> = {
    app: {info: opts.appInfo ?? vi.fn()},
    collaborator: {create: opts.createCollaborator ?? vi.fn()},
    teamAppCollaborator: {create: opts.createTeamAppCollaborator ?? vi.fn()},
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

describe('add', () => {
  it('adds a personal-app collaborator via collaborator.create', async () => {
    const created = {id: 'collaborator-1'}
    const createCollaborator = vi.fn().mockResolvedValue(created)
    const createTeamAppCollaborator = vi.fn()
    const ctx = buildCtx({
      appInfo: vi.fn().mockResolvedValue(personalApp()),
      createCollaborator,
      createTeamAppCollaborator,
    })

    const result = await add(ctx, 'personal-app', 'member@example.com')

    expect(createCollaborator).toHaveBeenCalledExactlyOnceWith('personal-app', {user: 'member@example.com'})
    expect(createTeamAppCollaborator).not.toHaveBeenCalled()
    expect(result).toBe(created)
  })

  it('ignores supplied permissions for a personal app', async () => {
    const created = {id: 'collaborator-1'}
    const createCollaborator = vi.fn().mockResolvedValue(created)
    const ctx = buildCtx({
      appInfo: vi.fn().mockResolvedValue(personalApp()),
      createCollaborator,
    })

    await add(ctx, 'personal-app', 'member@example.com', {permissions: ['deploy']})

    expect(createCollaborator).toHaveBeenCalledExactlyOnceWith('personal-app', {user: 'member@example.com'})
  })

  it('adds a team-app collaborator with normalized permissions via teamAppCollaborator.create', async () => {
    const created = {id: 'collaborator-1'}
    const createTeamAppCollaborator = vi.fn().mockResolvedValue(created)
    const createCollaborator = vi.fn()
    const ctx = buildCtx({
      appInfo: vi.fn().mockResolvedValue(teamApp()),
      createCollaborator,
      createTeamAppCollaborator,
    })

    const result = await add(ctx, 'team-app', 'member@example.com', {permissions: ['deploy']})

    expect(createTeamAppCollaborator).toHaveBeenCalledExactlyOnceWith('team-app', {
      permissions: ['deploy', 'view'],
      user: 'member@example.com',
    })
    expect(createCollaborator).not.toHaveBeenCalled()
    expect(result).toBe(created)
  })

  it('adds a team-app collaborator via teamAppCollaborator.create without permissions when none are supplied', async () => {
    const created = {id: 'collaborator-1'}
    const createTeamAppCollaborator = vi.fn().mockResolvedValue(created)
    const createCollaborator = vi.fn()
    const ctx = buildCtx({
      appInfo: vi.fn().mockResolvedValue(teamApp()),
      createCollaborator,
      createTeamAppCollaborator,
    })

    const result = await add(ctx, 'team-app', 'member@example.com')

    expect(createTeamAppCollaborator).toHaveBeenCalledExactlyOnceWith('team-app', {user: 'member@example.com'})
    expect(createCollaborator).not.toHaveBeenCalled()
    expect(result).toBe(created)
  })

  it('throws if signal is aborted', async () => {
    const ctx = buildCtx({})
    const controller = new AbortController()
    controller.abort()

    await expect(add(ctx, 'app', 'member@example.com', {signal: controller.signal})).rejects.toThrow()
  })

  it('binds the signal to the platform client', async () => {
    const controller = new AbortController()
    const ctx = buildCtx({
      appInfo: vi.fn().mockResolvedValue(personalApp()),
      createCollaborator: vi.fn().mockResolvedValue({id: 'collaborator-1'}),
    })

    await add(ctx, 'personal-app', 'member@example.com', {signal: controller.signal})

    expect(ctx.platform.withOptions).toHaveBeenCalledExactlyOnceWith({signal: controller.signal})
  })
})
