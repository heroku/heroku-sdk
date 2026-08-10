import {
  describe, expect, it, vi,
} from 'vitest'

import type {ResourceCtx} from '../../../core/extend-resource.js'

import {transferApp} from './transfer.js'

function ctx(platform: unknown): ResourceCtx {
  return {data: {} as never, metrics: {} as never, platform: platform as never}
}

describe('transferApp', () => {
  it('personal-to-personal uses appTransfer.create with app+recipient', async () => {
    const create = vi.fn().mockResolvedValue({state: 'pending'})
    const res = await transferApp(
      ctx({appTransfer: {create}}),
      'myapp',
      'person@example.com',
      {personalToPersonal: true},
    )
    expect(create).toHaveBeenCalledWith({app: 'myapp', recipient: 'person@example.com'})
    expect(res).toEqual({state: 'pending'})
  })

  it('team-involved transfer to a team name uses teamApp.transferToTeam with owner', async () => {
    // A real PATCH /teams/apps/{name} response is a TeamApp ({name, owner}),
    // not an AppTransfer — TeamApp has no `state`.
    const teamApp = {name: 'myapp', owner: {email: 'team@herokumanager.com'}}
    const transferToTeam = vi.fn().mockResolvedValue(teamApp)
    const transferToAccount = vi.fn()
    const res = await transferApp(
      ctx({teamApp: {transferToAccount, transferToTeam}}),
      'myapp',
      'acme-widgets',
      {personalToPersonal: false},
    )
    expect(transferToTeam).toHaveBeenCalledWith('myapp', {owner: 'acme-widgets'})
    expect(transferToAccount).not.toHaveBeenCalled()
    expect(res).toEqual(teamApp)
  })

  it('team-app transfer to a personal email uses teamApp.transferToAccount with owner', async () => {
    // The ambiguous case: source is a team app, recipient is a personal email →
    // personalToPersonal is false, but the target is an ACCOUNT, not a team.
    // Response is still a TeamApp ({name, owner}) — the app now belongs to the account.
    const teamApp = {name: 'myapp', owner: {email: 'person@example.com'}}
    const transferToAccount = vi.fn().mockResolvedValue(teamApp)
    const transferToTeam = vi.fn()
    const res = await transferApp(
      ctx({teamApp: {transferToAccount, transferToTeam}}),
      'myapp',
      'person@example.com',
      {personalToPersonal: false},
    )
    expect(transferToAccount).toHaveBeenCalledWith('myapp', {owner: 'person@example.com'})
    expect(transferToTeam).not.toHaveBeenCalled()
    expect(res).toEqual(teamApp)
  })

  it('passes silent through to appTransfer.create when set', async () => {
    const create = vi.fn().mockResolvedValue({state: 'pending'})
    await transferApp(ctx({appTransfer: {create}}), 'myapp', 'p@x.com', {personalToPersonal: true, silent: true})
    expect(create).toHaveBeenCalledWith({app: 'myapp', recipient: 'p@x.com', silent: true})
  })

  it('honors abort signal', async () => {
    const ac = new AbortController()
    ac.abort()
    await expect(transferApp(ctx({}), 'myapp', 'p@x.com', {personalToPersonal: true, signal: ac.signal})).rejects.toThrow()
  })

  it('threads the signal into requests via platform.withOptions', async () => {
    const ac = new AbortController()
    const create = vi.fn().mockResolvedValue({state: 'pending'})
    const scoped = {appTransfer: {create}}
    const withOptions = vi.fn().mockReturnValue(scoped)
    const platform = {appTransfer: {create: vi.fn()}, withOptions}

    await transferApp(ctx(platform), 'myapp', 'p@x.com', {personalToPersonal: true, signal: ac.signal})

    expect(withOptions).toHaveBeenCalledWith({signal: ac.signal})
    expect(create).toHaveBeenCalledWith({app: 'myapp', recipient: 'p@x.com'})
    // Requests route through the scoped client, not the bare one.
    expect(platform.appTransfer.create).not.toHaveBeenCalled()
  })

  it('threads the signal into team-transfer requests via platform.withOptions', async () => {
    const ac = new AbortController()
    const transferToTeam = vi.fn().mockResolvedValue({name: 'myapp', owner: {email: 'team@herokumanager.com'}})
    const scoped = {teamApp: {transferToAccount: vi.fn(), transferToTeam}}
    const withOptions = vi.fn().mockReturnValue(scoped)
    const platform = {teamApp: {transferToAccount: vi.fn(), transferToTeam: vi.fn()}, withOptions}

    await transferApp(ctx(platform), 'myapp', 'acme-widgets', {personalToPersonal: false, signal: ac.signal})

    expect(withOptions).toHaveBeenCalledWith({signal: ac.signal})
    expect(transferToTeam).toHaveBeenCalledWith('myapp', {owner: 'acme-widgets'})
    expect(platform.teamApp.transferToTeam).not.toHaveBeenCalled()
  })

  it('exposed on appExtensions.factory', async () => {
    const {appExtensions} = await import('./index.js')
    const create = vi.fn().mockResolvedValue({state: 'pending'})
    const methods = appExtensions.factory(ctx({appTransfer: {create}}))
    expect(typeof methods.transfer).toBe('function')
  })
})
