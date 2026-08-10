import {
  describe, expect, it, vi,
} from 'vitest'

import type {ResourceCtx} from '../../../core/extend-resource.js'

import {transferApp} from './transfer.js'

function ctx(platform: unknown): ResourceCtx {
  return {data: {} as never, metrics: {} as never, platform: platform as never}
}

// Full fake platform with spies at both the top level and a scoped level that
// `withOptions({signal})` returns, so tests can assert which client dispatch
// landed on (the raw client vs. the signal-scoped one).
function fakePlatform() {
  const scoped = {
    appTransfer: {create: vi.fn().mockResolvedValue({state: 'pending'})},
    teamApp: {
      transferToAccount: vi.fn().mockResolvedValue({state: 'transferred'}),
      transferToTeam: vi.fn().mockResolvedValue({state: 'transferred'}),
    },
  }
  const withOptions = vi.fn().mockReturnValue(scoped)
  const platform = {
    appTransfer: {create: vi.fn().mockResolvedValue({state: 'pending'})},
    teamApp: {
      transferToAccount: vi.fn().mockResolvedValue({state: 'transferred'}),
      transferToTeam: vi.fn().mockResolvedValue({state: 'transferred'}),
    },
    withOptions,
  }
  return {platform, scoped, withOptions}
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
    const transferToTeam = vi.fn().mockResolvedValue({state: 'transferred'})
    const transferToAccount = vi.fn()
    const res = await transferApp(
      ctx({teamApp: {transferToAccount, transferToTeam}}),
      'myapp',
      'acme-widgets',
      {personalToPersonal: false},
    )
    expect(transferToTeam).toHaveBeenCalledWith('myapp', {owner: 'acme-widgets'})
    expect(transferToAccount).not.toHaveBeenCalled()
    expect(res).toEqual({state: 'transferred'})
  })

  it('team-app transfer to a personal email uses teamApp.transferToAccount with owner', async () => {
    // The ambiguous case: source is a team app, recipient is a personal email →
    // personalToPersonal is false, but the target is an ACCOUNT, not a team.
    const transferToAccount = vi.fn().mockResolvedValue({state: 'transferred'})
    const transferToTeam = vi.fn()
    const res = await transferApp(
      ctx({teamApp: {transferToAccount, transferToTeam}}),
      'myapp',
      'person@example.com',
      {personalToPersonal: false},
    )
    expect(transferToAccount).toHaveBeenCalledWith('myapp', {owner: 'person@example.com'})
    expect(transferToTeam).not.toHaveBeenCalled()
    expect(res).toEqual({state: 'transferred'})
  })

  it('passes silent through to appTransfer.create when set', async () => {
    const create = vi.fn().mockResolvedValue({state: 'pending'})
    await transferApp(ctx({appTransfer: {create}}), 'myapp', 'p@x.com', {personalToPersonal: true, silent: true})
    expect(create).toHaveBeenCalledWith({app: 'myapp', recipient: 'p@x.com', silent: true})
  })

  it('honors an already-aborted signal pre-flight and dispatches nothing', async () => {
    const {platform, scoped} = fakePlatform()
    const call = transferApp(ctx(platform), 'myapp', 'p@x.com', {personalToPersonal: true, signal: AbortSignal.abort()})
    await expect(call).rejects.toThrow()
    // None of the three platform surfaces should have been touched — proves the
    // rejection came from the pre-flight throwIfAborted(), not a downstream crash.
    expect(platform.appTransfer.create).not.toHaveBeenCalled()
    expect(platform.teamApp.transferToAccount).not.toHaveBeenCalled()
    expect(platform.teamApp.transferToTeam).not.toHaveBeenCalled()
    expect(scoped.appTransfer.create).not.toHaveBeenCalled()
    expect(scoped.teamApp.transferToAccount).not.toHaveBeenCalled()
    expect(scoped.teamApp.transferToTeam).not.toHaveBeenCalled()
  })

  it('threads the signal into a scoped client and dispatches on it', async () => {
    const {platform, scoped, withOptions} = fakePlatform()
    const {signal} = new AbortController()
    await transferApp(ctx(platform), 'myapp', 'acme-widgets', {signal})
    expect(withOptions).toHaveBeenCalledWith({signal})
    // Dispatch lands on the scoped client, not the raw one.
    expect(scoped.teamApp.transferToTeam).toHaveBeenCalledWith('myapp', {owner: 'acme-widgets'})
    expect(platform.teamApp.transferToTeam).not.toHaveBeenCalled()
  })

  it('does not scope the client when no signal is given', async () => {
    const {platform, withOptions} = fakePlatform()
    await transferApp(ctx(platform), 'myapp', 'acme-widgets', {})
    expect(withOptions).not.toHaveBeenCalled()
    expect(platform.teamApp.transferToTeam).toHaveBeenCalledWith('myapp', {owner: 'acme-widgets'})
  })

  it('defaults to the team route (transferToTeam) when personalToPersonal is omitted', async () => {
    const {platform} = fakePlatform()
    await transferApp(ctx(platform), 'myapp', 'acme-widgets')
    expect(platform.teamApp.transferToTeam).toHaveBeenCalledWith('myapp', {owner: 'acme-widgets'})
    expect(platform.appTransfer.create).not.toHaveBeenCalled()
  })

  it('defaults an email recipient to transferToAccount when personalToPersonal is omitted', async () => {
    const {platform} = fakePlatform()
    await transferApp(ctx(platform), 'myapp', 'person@example.com')
    expect(platform.teamApp.transferToAccount).toHaveBeenCalledWith('myapp', {owner: 'person@example.com'})
    expect(platform.appTransfer.create).not.toHaveBeenCalled()
  })

  it('omits silent from appTransfer.create when unset', async () => {
    const {platform} = fakePlatform()
    await transferApp(ctx(platform), 'myapp', 'p@x.com', {personalToPersonal: true})
    expect(platform.appTransfer.create).toHaveBeenCalledWith({app: 'myapp', recipient: 'p@x.com'})
  })

  it('does not forward silent on the team path', async () => {
    const {platform} = fakePlatform()
    await transferApp(ctx(platform), 'myapp', 'acme-widgets', {silent: true})
    // Team route carries only {owner}; silent is a personal-transfer-only field.
    expect(platform.teamApp.transferToTeam).toHaveBeenCalledWith('myapp', {owner: 'acme-widgets'})
    expect(platform.appTransfer.create).not.toHaveBeenCalled()
  })
})
