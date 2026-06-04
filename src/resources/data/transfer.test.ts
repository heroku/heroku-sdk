import type {AddOnAttachment} from '@heroku/types/3.sdk'

import {
  describe, expect, it, vi,
} from 'vitest'

import type {ResourceCtx} from '../../core/extend-resource.js'

import {listByApp, transferExtensions} from './transfer.js'

function buildCtx(opts: {
  listByApp?: ReturnType<typeof vi.fn>
  resolutionByAttachment?: ReturnType<typeof vi.fn>
}): ResourceCtx {
  return {
    data: {
      transfer: {
        listByApp: opts.listByApp ?? vi.fn(),
      },
    } as never,
    platform: {
      addOnAttachment: {resolution: opts.resolutionByAttachment ?? vi.fn()},
    } as never,
  }
}

const oneAttachmentMatch = [
  {addon: {app: {id: 'app-uuid', name: 'app-1'}, id: 'addon-1', name: 'pg-attached'}} as AddOnAttachment,
]

describe('transfer resource', () => {
  it('listByApp resolves the addon and calls transfer.listByApp', async () => {
    const resolutionByAttachment = vi.fn().mockResolvedValue(oneAttachmentMatch)
    const listByAppFn = vi.fn().mockResolvedValue([{num: 1, succeeded: true}])
    const ctx = buildCtx({listByApp: listByAppFn, resolutionByAttachment})

    const result = await listByApp(ctx, 'app-1')

    expect(listByAppFn).toHaveBeenCalledWith('addon-1')
    expect(result).toEqual([{num: 1, succeeded: true}])
  })

  it('listByApp returns [] when the addon resolver throws 404', async () => {
    const notFound = Object.assign(new Error('Not Found'), {statusCode: 404})
    const resolutionByAttachment = vi.fn().mockRejectedValue(notFound)
    const ctx = buildCtx({resolutionByAttachment})

    const result = await listByApp(ctx, 'app-without-pg')

    expect(result).toEqual([])
  })

  it('listByApp rethrows non-404 resolver errors', async () => {
    const serverError = Object.assign(new Error('Internal Server Error'), {statusCode: 500})
    const resolutionByAttachment = vi.fn().mockRejectedValue(serverError)
    const ctx = buildCtx({resolutionByAttachment})

    await expect(listByApp(ctx, 'app-1')).rejects.toThrow('Internal Server Error')
  })

  it('listByApp throws if signal is aborted', async () => {
    const ctx = buildCtx({})
    const controller = new AbortController()
    controller.abort()

    await expect(listByApp(ctx, 'app-1', undefined, {signal: controller.signal})).rejects.toThrow()
  })

  it('transferExtensions declares service: data, resource: transfer', () => {
    expect(transferExtensions.service).toBe('data')
    expect(transferExtensions.resource).toBe('transfer')
  })

  it('transferExtensions factory exposes listByApp', () => {
    const methods = transferExtensions.factory(buildCtx({}))
    expect(typeof methods.listByApp).toBe('function')
  })
})
