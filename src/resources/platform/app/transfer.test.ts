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
    const transferToTeam = vi.fn().mockResolvedValue({state: 'accepted'})
    const transferToAccount = vi.fn()
    const res = await transferApp(
      ctx({teamApp: {transferToAccount, transferToTeam}}),
      'myapp',
      'acme-widgets',
      {personalToPersonal: false},
    )
    expect(transferToTeam).toHaveBeenCalledWith('myapp', {owner: 'acme-widgets'})
    expect(transferToAccount).not.toHaveBeenCalled()
    expect(res).toEqual({state: 'accepted'})
  })

  it('team-app transfer to a personal email uses teamApp.transferToAccount with owner', async () => {
    // The ambiguous case: source is a team app, recipient is a personal email →
    // personalToPersonal is false, but the target is an ACCOUNT, not a team.
    const transferToAccount = vi.fn().mockResolvedValue({state: 'accepted'})
    const transferToTeam = vi.fn()
    const res = await transferApp(
      ctx({teamApp: {transferToAccount, transferToTeam}}),
      'myapp',
      'person@example.com',
      {personalToPersonal: false},
    )
    expect(transferToAccount).toHaveBeenCalledWith('myapp', {owner: 'person@example.com'})
    expect(transferToTeam).not.toHaveBeenCalled()
    expect(res).toEqual({state: 'accepted'})
  })

  it('passes silent through to appTransfer.create when set', async () => {
    const create = vi.fn().mockResolvedValue({state: 'pending'})
    await transferApp(ctx({appTransfer: {create}}), 'myapp', 'p@x.com', {personalToPersonal: true, silent: true})
    expect(create).toHaveBeenCalledWith({app: 'myapp', recipient: 'p@x.com', silent: true})
  })

  it('honors abort signal', async () => {
    const ac = new AbortController()
    ac.abort()
    await expect(transferApp(ctx({}), 'myapp', 'p@x.com', {signal: ac.signal})).rejects.toThrow()
  })

  it('exposed on appExtensions.factory', async () => {
    const {appExtensions} = await import('./index.js')
    const create = vi.fn().mockResolvedValue({state: 'pending'})
    const methods = appExtensions.factory(ctx({appTransfer: {create}}))
    expect(typeof methods.transfer).toBe('function')
  })
})
