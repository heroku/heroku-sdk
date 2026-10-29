import type {TeamAppCollaborator} from '@heroku/types/3.sdk'

import {
  describe, expect, it, vi,
} from 'vitest'

import type {ResourceCtx} from '../../../core/extend-resource.js'

import {joinSelf} from './join-self.js'

function buildCtx({
  accountInfo = vi.fn().mockResolvedValue({email: 'member+tag@example.com'}),
  create = vi.fn().mockResolvedValue({id: 'collaborator-1'} as TeamAppCollaborator),
  scoped = false,
} = {}) {
  const scopedPlatform = {
    account: {info: accountInfo},
    teamAppCollaborator: {create},
  }
  const basePlatform = {
    account: {info: vi.fn()},
    teamAppCollaborator: {create: vi.fn()},
    withOptions: vi.fn().mockReturnValue(scopedPlatform),
  }
  return {
    accountInfo,
    basePlatform,
    create,
    ctx: {platform: (scoped ? basePlatform : scopedPlatform) as never} as ResourceCtx,
    scopedPlatform,
  }
}

describe('joinSelf', () => {
  it('looks up the account before creating a team-app collaborator with its raw email', async () => {
    const calls: string[] = []
    const accountInfo = vi.fn(async () => {
      calls.push('account.info')
      return {email: 'member+tag@example.com'}
    })
    const created = {id: 'collaborator-1'} as TeamAppCollaborator
    const create = vi.fn(async () => {
      calls.push('teamAppCollaborator.create')
      return created
    })
    const {ctx} = buildCtx({accountInfo, create})

    const result = await joinSelf(ctx, 'team-app')

    expect(calls).toEqual(['account.info', 'teamAppCollaborator.create'])
    expect(accountInfo).toHaveBeenCalledExactlyOnceWith()
    expect(create).toHaveBeenCalledExactlyOnceWith('team-app', {user: 'member+tag@example.com'})
    expect(result).toBe(created)
  })

  it('propagates account lookup failures without creating a collaborator', async () => {
    const error = new Error('account lookup failed')
    const {accountInfo, create, ctx} = buildCtx({accountInfo: vi.fn().mockRejectedValue(error)})

    await expect(joinSelf(ctx, 'team-app')).rejects.toBe(error)
    expect(accountInfo).toHaveBeenCalledExactlyOnceWith()
    expect(create).not.toHaveBeenCalled()
  })

  it('throws for an already-aborted signal before any request', async () => {
    const controller = new AbortController()
    controller.abort()
    const {accountInfo, basePlatform, create, ctx} = buildCtx({scoped: true})

    await expect(joinSelf(ctx, 'team-app', {signal: controller.signal})).rejects.toThrow()

    expect(accountInfo).not.toHaveBeenCalled()
    expect(create).not.toHaveBeenCalled()
    expect(basePlatform.withOptions).not.toHaveBeenCalled()
  })

  it('binds requests to the signal-scoped client', async () => {
    const controller = new AbortController()
    const {accountInfo, basePlatform, create, ctx} = buildCtx({scoped: true})

    await joinSelf(ctx, 'team-app', {signal: controller.signal})

    expect(basePlatform.withOptions).toHaveBeenCalledExactlyOnceWith({signal: controller.signal})
    expect(accountInfo).toHaveBeenCalledExactlyOnceWith()
    expect(create).toHaveBeenCalledExactlyOnceWith('team-app', {user: 'member+tag@example.com'})
    expect(basePlatform.account.info).not.toHaveBeenCalled()
    expect(basePlatform.teamAppCollaborator.create).not.toHaveBeenCalled()
  })

  it('does not create a collaborator if the signal aborts during account lookup', async () => {
    const controller = new AbortController()
    const accountInfo = vi.fn().mockImplementation(async () => {
      controller.abort()
      return {email: 'member@example.com'}
    })
    const {basePlatform, create, ctx} = buildCtx({accountInfo, scoped: true})

    await expect(joinSelf(ctx, 'team-app', {signal: controller.signal})).rejects.toThrow()
    expect(basePlatform.withOptions).toHaveBeenCalledExactlyOnceWith({signal: controller.signal})
    expect(accountInfo).toHaveBeenCalledExactlyOnceWith()
    expect(create).not.toHaveBeenCalled()
  })
})
