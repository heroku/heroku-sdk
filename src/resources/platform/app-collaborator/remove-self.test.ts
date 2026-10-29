import type {Account, AccountDelinquency, Collaborator} from '@heroku/types/3.sdk'

import {
  afterEach, describe, expect, it, vi,
} from 'vitest'

import type {ResourceCtx} from '../../../core/extend-resource.js'

import {HerokuSDK} from '../../../core/heroku-sdk.js'
import {appCollaboratorExtensions} from './index.js'
import {removeSelf} from './remove-self.js'

function buildCtx({
  accountInfo = vi.fn().mockResolvedValue({email: 'member+tag@example.com'} as Account),
  deleteCollaborator = vi.fn().mockResolvedValue({id: 'deleted-collaborator'} as Collaborator),
  delinquencyInfo = vi.fn().mockResolvedValue(null),
} = {}) {
  const createScopedPlatform = () => ({
    account: {info: vi.fn(() => accountInfo())},
    accountDelinquency: {info: vi.fn(() => delinquencyInfo())},
    collaborator: {delete: vi.fn((...args: Parameters<typeof deleteCollaborator>) => deleteCollaborator(...args))},
    withOptions: vi.fn(),
  })
  const scopedPlatforms: ReturnType<typeof createScopedPlatform>[] = []
  const basePlatform = {
    account: {info: vi.fn(() => accountInfo())},
    accountDelinquency: {info: vi.fn(() => delinquencyInfo())},
    collaborator: {delete: vi.fn((...args: Parameters<typeof deleteCollaborator>) => deleteCollaborator(...args))},
    withOptions: vi.fn(() => {
      const scopedPlatform = createScopedPlatform()
      scopedPlatforms.push(scopedPlatform)
      return scopedPlatform
    }),
  }

  return {
    accountInfo,
    basePlatform,
    ctx: {platform: basePlatform as never} as ResourceCtx,
    deleteCollaborator,
    delinquencyInfo,
    scopedPlatforms,
  }
}

/* eslint-disable camelcase -- platform delinquency wire fields */
describe('removeSelf', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('passes the raw account email through the SDK and encodes it once in the collaborator path', async () => {
    const email = 'member+tag@example.com'
    const expectedDeleteUrl = 'https://api.heroku.com/apps/team-app/collaborators/member%2Btag%40example.com'
    const requests: Request[] = []
    const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
      const request = input instanceof Request ? input : new Request(input, init)
      requests.push(request)

      if (request.method === 'GET' && request.url === 'https://api.heroku.com/account') {
        return new Response(JSON.stringify({email}), {headers: {'content-type': 'application/json'}})
      }

      if (request.method === 'DELETE' && request.url === expectedDeleteUrl) {
        return new Response(JSON.stringify({id: 'deleted-collaborator'}), {headers: {'content-type': 'application/json'}})
      }

      throw new Error(`Unexpected network request: ${request.method} ${request.url}`)
    })
    vi.stubGlobal('fetch', fetch)

    const sdk = new HerokuSDK({
      clientOptions: {token: 'test-token'},
      extensions: [appCollaboratorExtensions],
    })

    await expect(sdk.platform.appCollaborator.removeSelf('team-app')).resolves.toEqual({id: 'deleted-collaborator'})

    expect(fetch).toHaveBeenCalledTimes(2)
    expect(requests.map(({method, url}) => `${method} ${url}`)).toEqual([
      'GET https://api.heroku.com/account',
      `DELETE ${expectedDeleteUrl}`,
    ])
  })

  it('looks up the account then deletes by its raw email and returns the deleted collaborator', async () => {
    const account = {email: 'member+tag@example.com'} as Account
    const deleted = {id: 'deleted-collaborator'} as Collaborator
    const calls: string[] = []
    const accountInfo = vi.fn(async () => {
      calls.push('account.info')
      return account
    })
    const deleteCollaborator = vi.fn(async () => {
      calls.push('collaborator.delete')
      return deleted
    })
    const {ctx, delinquencyInfo} = buildCtx({accountInfo, deleteCollaborator})

    const result = await removeSelf(ctx, 'team-app')

    expect(calls).toEqual(['account.info', 'collaborator.delete'])
    expect(accountInfo).toHaveBeenCalledExactlyOnceWith()
    expect(delinquencyInfo).not.toHaveBeenCalled()
    expect(deleteCollaborator).toHaveBeenCalledExactlyOnceWith('team-app', account.email)
    expect(result).toBe(deleted)
  })

  it('propagates an account lookup failure and does not delete', async () => {
    const error = new Error('account lookup failed')
    const {accountInfo, ctx, deleteCollaborator} = buildCtx({accountInfo: vi.fn().mockRejectedValue(error)})

    await expect(removeSelf(ctx, 'team-app')).rejects.toBe(error)
    expect(accountInfo).toHaveBeenCalledExactlyOnceWith()
    expect(deleteCollaborator).not.toHaveBeenCalled()
  })

  it('uses getAccountWithDelinquency and awaits beforeRemove before deleting', async () => {
    const account = {email: 'member+tag@example.com'} as Account
    const delinquency = {scheduled_deletion_time: null, scheduled_suspension_time: null} as AccountDelinquency
    const calls: string[] = []
    const accountInfo = vi.fn(async () => {
      calls.push('account.info')
      return account
    })
    const delinquencyInfo = vi.fn(async () => {
      calls.push('accountDelinquency.info')
      return delinquency
    })
    const deleteCollaborator = vi.fn(async () => {
      calls.push('collaborator.delete')
      return {id: 'deleted'} as Collaborator
    })
    const beforeRemove = vi.fn(async received => {
      calls.push('beforeRemove:start')
      expect(received.account).toBe(account)
      expect(received.delinquency).toBe(delinquency)
      await Promise.resolve()
      calls.push('beforeRemove:done')
    })
    const controller = new AbortController()
    const {
      basePlatform, ctx, scopedPlatforms,
    } = buildCtx({accountInfo, deleteCollaborator, delinquencyInfo})

    await removeSelf(ctx, 'team-app', {beforeRemove, signal: controller.signal})

    expect(basePlatform.withOptions).toHaveBeenCalledTimes(2)
    expect(basePlatform.withOptions).toHaveBeenNthCalledWith(1, {signal: controller.signal})
    expect(basePlatform.withOptions).toHaveBeenNthCalledWith(2, {signal: controller.signal})
    expect(scopedPlatforms).toHaveLength(2)
    expect(scopedPlatforms[0]).not.toBe(scopedPlatforms[1])
    expect(scopedPlatforms[0].account.info).toHaveBeenCalledExactlyOnceWith()
    expect(scopedPlatforms[0].accountDelinquency.info).toHaveBeenCalledExactlyOnceWith()
    expect(scopedPlatforms[1].collaborator.delete).toHaveBeenCalledExactlyOnceWith('team-app', account.email)
    expect(basePlatform.account.info).not.toHaveBeenCalled()
    expect(basePlatform.accountDelinquency.info).not.toHaveBeenCalled()
    expect(basePlatform.collaborator.delete).not.toHaveBeenCalled()
    expect(accountInfo).toHaveBeenCalledExactlyOnceWith()
    expect(delinquencyInfo).toHaveBeenCalledExactlyOnceWith()
    expect(beforeRemove).toHaveBeenCalledExactlyOnceWith({account, delinquency})
    expect(deleteCollaborator).toHaveBeenCalledExactlyOnceWith('team-app', account.email)
    expect(calls).toEqual([
      'account.info', 'accountDelinquency.info', 'beforeRemove:start', 'beforeRemove:done', 'collaborator.delete',
    ])
  })

  it('passes null delinquency to the hook when the helper soft-fails its lookup', async () => {
    const account = {email: 'member@example.com'} as Account
    const beforeRemove = vi.fn()
    const {ctx, deleteCollaborator} = buildCtx({
      accountInfo: vi.fn().mockResolvedValue(account),
      delinquencyInfo: vi.fn().mockRejectedValue(new Error('delinquency unavailable')),
    })

    await removeSelf(ctx, 'team-app', {beforeRemove})

    expect(beforeRemove).toHaveBeenCalledExactlyOnceWith({account, delinquency: null})
    expect(deleteCollaborator).toHaveBeenCalledExactlyOnceWith('team-app', account.email)
  })

  it('propagates a primary account lookup failure in hook mode without calling the hook or deleting', async () => {
    const error = new Error('account lookup failed')
    const beforeRemove = vi.fn()
    const {accountInfo, ctx, deleteCollaborator} = buildCtx({accountInfo: vi.fn().mockRejectedValue(error)})

    await expect(removeSelf(ctx, 'team-app', {beforeRemove})).rejects.toBe(error)
    expect(accountInfo).toHaveBeenCalledExactlyOnceWith()
    expect(beforeRemove).not.toHaveBeenCalled()
    expect(deleteCollaborator).not.toHaveBeenCalled()
  })

  it('throws for an already-aborted signal before lookup or deletion', async () => {
    const controller = new AbortController()
    controller.abort()
    const {accountInfo, ctx, deleteCollaborator} = buildCtx()

    await expect(removeSelf(ctx, 'team-app', {signal: controller.signal})).rejects.toThrow()
    expect(accountInfo).not.toHaveBeenCalled()
    expect(deleteCollaborator).not.toHaveBeenCalled()
  })

  it('does not delete if the signal aborts during a direct account lookup', async () => {
    const controller = new AbortController()
    const accountInfo = vi.fn().mockImplementation(async () => {
      controller.abort()
      return {email: 'member@example.com'} as Account
    })
    const {ctx, deleteCollaborator} = buildCtx({accountInfo})

    await expect(removeSelf(ctx, 'team-app', {signal: controller.signal})).rejects.toThrow()
    expect(accountInfo).toHaveBeenCalledExactlyOnceWith()
    expect(deleteCollaborator).not.toHaveBeenCalled()
  })

  it('does not call beforeRemove or delete if the signal aborts during lookup', async () => {
    const controller = new AbortController()
    const accountInfo = vi.fn().mockImplementation(async () => {
      controller.abort()
      return {email: 'member@example.com'} as Account
    })
    const beforeRemove = vi.fn()
    const {ctx, deleteCollaborator} = buildCtx({accountInfo})

    await expect(removeSelf(ctx, 'team-app', {beforeRemove, signal: controller.signal})).rejects.toThrow()
    expect(beforeRemove).not.toHaveBeenCalled()
    expect(deleteCollaborator).not.toHaveBeenCalled()
  })

  it('does not delete if the signal aborts while beforeRemove is running', async () => {
    const controller = new AbortController()
    const beforeRemove = vi.fn(async () => {
      controller.abort()
    })
    const {ctx, deleteCollaborator} = buildCtx()

    await expect(removeSelf(ctx, 'team-app', {beforeRemove, signal: controller.signal})).rejects.toThrow()
    expect(beforeRemove).toHaveBeenCalledOnce()
    expect(deleteCollaborator).not.toHaveBeenCalled()
  })

  it('propagates beforeRemove rejection without deleting', async () => {
    const error = new Error('confirmation rejected')
    const beforeRemove = vi.fn().mockRejectedValue(error)
    const {ctx, deleteCollaborator} = buildCtx()

    await expect(removeSelf(ctx, 'team-app', {beforeRemove})).rejects.toBe(error)
    expect(beforeRemove).toHaveBeenCalledOnce()
    expect(deleteCollaborator).not.toHaveBeenCalled()
  })

  it('binds lookup and deletion requests to the signal-scoped client', async () => {
    const controller = new AbortController()
    const account = {email: 'member@example.com'} as Account
    const accountInfo = vi.fn().mockResolvedValue(account)
    const deleteCollaborator = vi.fn().mockResolvedValue({id: 'deleted'} as Collaborator)
    const {basePlatform, ctx, deleteCollaborator: actualDelete, scopedPlatforms} = buildCtx({accountInfo, deleteCollaborator})

    await removeSelf(ctx, 'team-app', {signal: controller.signal})

    expect(basePlatform.withOptions).toHaveBeenCalledTimes(2)
    expect(basePlatform.withOptions).toHaveBeenNthCalledWith(1, {signal: controller.signal})
    expect(basePlatform.withOptions).toHaveBeenNthCalledWith(2, {signal: controller.signal})
    expect(scopedPlatforms).toHaveLength(2)
    expect(scopedPlatforms[0]).not.toBe(scopedPlatforms[1])
    expect(scopedPlatforms[0].account.info).toHaveBeenCalledExactlyOnceWith()
    expect(scopedPlatforms[1].collaborator.delete).toHaveBeenCalledExactlyOnceWith('team-app', account.email)
    expect(accountInfo).toHaveBeenCalledExactlyOnceWith()
    expect(actualDelete).toHaveBeenCalledExactlyOnceWith('team-app', account.email)
    expect(basePlatform.account.info).not.toHaveBeenCalled()
    expect(basePlatform.collaborator.delete).not.toHaveBeenCalled()
    expect(ctx.platform).toBe(basePlatform)
  })
})
/* eslint-enable camelcase */
