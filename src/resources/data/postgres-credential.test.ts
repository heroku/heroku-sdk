import type {AddOnAttachment} from '@heroku/types/3.sdk'

import {
  describe, expect, it, vi,
} from 'vitest'

import type {ResourceCtx} from '../../core/extend-resource.js'

import {info, list, postgresCredentialExtensions} from './postgres-credential.js'

function buildCtx(opts: {
  credentialInfo?: ReturnType<typeof vi.fn>
  credentialList?: ReturnType<typeof vi.fn>
  resolution?: ReturnType<typeof vi.fn>
  resolutionByAttachment?: ReturnType<typeof vi.fn>
}): ResourceCtx {
  return {
    data: {
      postgresCredential: {
        info: opts.credentialInfo ?? vi.fn(),
        list: opts.credentialList ?? vi.fn(),
      },
    } as never,
    platform: {
      addOn: {resolution: opts.resolution ?? vi.fn()},
      addOnAttachment: {resolution: opts.resolutionByAttachment ?? vi.fn()},
    } as never,
  }
}

const oneAttachmentMatch = [
  {addon: {app: {id: 'app-uuid', name: 'app-1'}, id: 'addon-1', name: 'pg-attached'}} as AddOnAttachment,
]

describe('postgres-credential resource', () => {
  it('list resolves the addon and calls postgresCredential.list', async () => {
    const resolutionByAttachment = vi.fn().mockResolvedValue(oneAttachmentMatch)
    const credentialList = vi.fn().mockResolvedValue({items: [{name: 'default'}]})
    const ctx = buildCtx({credentialList, resolutionByAttachment})

    const result = await list(ctx, 'app-1', 'DATABASE_URL')

    expect(resolutionByAttachment).toHaveBeenCalledWith({
      // eslint-disable-next-line camelcase
      addon_attachment: 'DATABASE_URL',
      app: 'app-1',
    })
    expect(credentialList).toHaveBeenCalledWith('addon-1')
    expect(result).toEqual({items: [{name: 'default'}]})
  })

  it('list defaults to DATABASE_URL attachment when no addonIdentity is given', async () => {
    const resolutionByAttachment = vi.fn().mockResolvedValue(oneAttachmentMatch)
    const credentialList = vi.fn().mockResolvedValue({})
    const ctx = buildCtx({credentialList, resolutionByAttachment})

    await list(ctx, 'app-1')

    expect(resolutionByAttachment).toHaveBeenCalledWith({
      // eslint-disable-next-line camelcase
      addon_attachment: 'DATABASE_URL',
      app: 'app-1',
    })
  })

  it('info resolves the addon and calls postgresCredential.info with credName', async () => {
    const resolutionByAttachment = vi.fn().mockResolvedValue(oneAttachmentMatch)
    const credentialInfo = vi.fn().mockResolvedValue({name: 'my-cred', state: 'active'})
    const ctx = buildCtx({credentialInfo, resolutionByAttachment})

    const result = await info(ctx, 'app-1', 'my-cred', 'DATABASE_URL')

    expect(credentialInfo).toHaveBeenCalledWith('addon-1', 'my-cred')
    expect(result).toEqual({name: 'my-cred', state: 'active'})
  })

  it('list throws if signal is aborted', async () => {
    const ctx = buildCtx({})
    const controller = new AbortController()
    controller.abort()

    await expect(list(ctx, 'app-1', undefined, {signal: controller.signal})).rejects.toThrow()
  })

  it('info throws if signal is aborted', async () => {
    const ctx = buildCtx({})
    const controller = new AbortController()
    controller.abort()

    await expect(info(ctx, 'app-1', 'cred', undefined, {signal: controller.signal})).rejects.toThrow()
  })

  it('postgresCredentialExtensions declares service: data, resource: postgresCredential', () => {
    expect(postgresCredentialExtensions.service).toBe('data')
    expect(postgresCredentialExtensions.resource).toBe('postgresCredential')
  })

  it('postgresCredentialExtensions factory exposes list and info', () => {
    const methods = postgresCredentialExtensions.factory(buildCtx({}))
    expect(typeof methods.list).toBe('function')
    expect(typeof methods.info).toBe('function')
  })
})
