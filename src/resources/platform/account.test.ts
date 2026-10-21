/* eslint-disable camelcase -- platform delinquency wire format */
import type {Account, AccountDelinquency} from '@heroku/types/3.sdk'

import {
  describe, expect, it, vi,
} from 'vitest'

import type {ResourceCtx} from '../../core/extend-resource.js'

import {accountExtensions, getAccountWithDelinquency} from './account.js'

type FakePlatform = {
  account: {info: ReturnType<typeof vi.fn>}
  accountDelinquency: {info: ReturnType<typeof vi.fn>}
  withOptions: ReturnType<typeof vi.fn>
}

function buildCtx(stubs: {
  accountInfo?: ReturnType<typeof vi.fn>
  delinquencyInfo?: ReturnType<typeof vi.fn>
} = {}): {ctx: ResourceCtx; platform: FakePlatform} {
  const platform: FakePlatform = {
    account: {info: stubs.accountInfo ?? vi.fn().mockResolvedValue({})},
    accountDelinquency: {info: stubs.delinquencyInfo ?? vi.fn().mockResolvedValue(null)},
    withOptions: vi.fn(),
  }
  platform.withOptions.mockReturnValue(platform)

  return {
    ctx: {platform: platform as never} as ResourceCtx,
    platform,
  }
}

describe('getAccountWithDelinquency', () => {
  it('returns the account together with its delinquency', async () => {
    const account = {email: 'a@b.com', id: 'acct-1'} as Account
    const delinquency = {
      scheduled_deletion_time: null,
      scheduled_suspension_time: '2026-02-01T00:00:00.000Z',
    } as AccountDelinquency

    const {ctx, platform} = buildCtx({
      accountInfo: vi.fn().mockResolvedValue(account),
      delinquencyInfo: vi.fn().mockResolvedValue(delinquency),
    })

    const result = await getAccountWithDelinquency(ctx)

    expect(result).toEqual({account, delinquency})
    expect(platform.account.info).toHaveBeenCalledExactlyOnceWith()
    expect(platform.accountDelinquency.info).toHaveBeenCalledExactlyOnceWith()
  })

  it('soft-fails the delinquency lookup to null without sinking the account fetch', async () => {
    const account = {id: 'acct-1'} as Account
    const {ctx} = buildCtx({
      accountInfo: vi.fn().mockResolvedValue(account),
      delinquencyInfo: vi.fn().mockRejectedValue(new Error('boom')),
    })

    const result = await getAccountWithDelinquency(ctx)

    expect(result.account).toEqual(account)
    expect(result.delinquency).toBeNull()
  })

  it('propagates an error from the account lookup', async () => {
    const {ctx} = buildCtx({
      accountInfo: vi.fn().mockRejectedValue(new Error('account-boom')),
    })

    await expect(getAccountWithDelinquency(ctx)).rejects.toThrow('account-boom')
  })

  it('throws if the abort signal is already aborted, without calling any route', async () => {
    const {ctx, platform} = buildCtx()
    const controller = new AbortController()
    controller.abort()

    await expect(getAccountWithDelinquency(ctx, {signal: controller.signal})).rejects.toThrow()
    expect(platform.account.info).not.toHaveBeenCalled()
    expect(platform.accountDelinquency.info).not.toHaveBeenCalled()
  })

  it('threads the signal through withOptions when provided', async () => {
    const {ctx, platform} = buildCtx()
    const controller = new AbortController()

    await getAccountWithDelinquency(ctx, {signal: controller.signal})

    expect(platform.withOptions).toHaveBeenCalledExactlyOnceWith({signal: controller.signal})
  })

  it('does not call withOptions when no signal is provided', async () => {
    const {ctx, platform} = buildCtx()

    await getAccountWithDelinquency(ctx)

    expect(platform.withOptions).not.toHaveBeenCalled()
  })
})

describe('accountExtensions.getWithDelinquency wiring', () => {
  it('exposes a getWithDelinquency method that delegates to getAccountWithDelinquency', async () => {
    const {ctx, platform} = buildCtx({
      accountInfo: vi.fn().mockResolvedValue({id: 'acct-1'} as Account),
    })
    const methods = accountExtensions.factory(ctx)

    expect(typeof methods.getWithDelinquency).toBe('function')
    const result = await methods.getWithDelinquency()
    expect(result.account).toEqual({id: 'acct-1'})
    expect(platform.account.info).toHaveBeenCalledExactlyOnceWith()
  })
})
