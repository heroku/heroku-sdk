import {
  describe, expect, it, vi,
} from 'vitest'

import type {ResourceCtx} from '../../core/extend-resource.js'

import {infoByApp, listByApp, transferExtensions} from './transfer.js'

function buildCtx(opts: {
  transferInfoByApp?: ReturnType<typeof vi.fn>
  transferListByApp?: ReturnType<typeof vi.fn>
}): ResourceCtx {
  return {
    data: {
      transfer: {
        infoByApp: opts.transferInfoByApp ?? vi.fn(),
        listByApp: opts.transferListByApp ?? vi.fn(),
      },
    } as never,
    platform: {} as never,
  }
}

describe('transfer resource', () => {
  it('listByApp calls transfer.listByApp with the app identity directly', async () => {
    const transferListByApp = vi.fn().mockResolvedValue([{uuid: 'xfer-1', from_type: 'pg_dump'}])
    const ctx = buildCtx({transferListByApp})

    const result = await listByApp(ctx, 'my-app')

    expect(transferListByApp).toHaveBeenCalledWith('my-app')
    expect(result).toEqual([{uuid: 'xfer-1', from_type: 'pg_dump'}])
  })

  it('infoByApp calls transfer.infoByApp with the app identity and xfer id', async () => {
    const transferInfoByApp = vi.fn().mockResolvedValue({uuid: 'xfer-1', num: '1', from_type: 'pg_dump', to_type: 'gof3r'})
    const ctx = buildCtx({transferInfoByApp})

    const result = await infoByApp(ctx, 'my-app', 'xfer-1')

    expect(transferInfoByApp).toHaveBeenCalledWith('my-app', 'xfer-1')
    expect(result).toEqual({uuid: 'xfer-1', num: '1', from_type: 'pg_dump', to_type: 'gof3r'})
  })

  it('listByApp throws if signal is aborted', async () => {
    const ctx = buildCtx({})
    const controller = new AbortController()
    controller.abort()

    await expect(listByApp(ctx, 'my-app', {signal: controller.signal})).rejects.toThrow()
  })

  it('infoByApp throws if signal is aborted', async () => {
    const ctx = buildCtx({})
    const controller = new AbortController()
    controller.abort()

    await expect(infoByApp(ctx, 'my-app', 'xfer-1', {signal: controller.signal})).rejects.toThrow()
  })

  it('transferExtensions declares service: data, resource: transfer', () => {
    expect(transferExtensions.service).toBe('data')
    expect(transferExtensions.resource).toBe('transfer')
  })

  it('transferExtensions factory exposes listByApp and infoByApp', () => {
    const methods = transferExtensions.factory(buildCtx({}))
    expect(typeof methods.listByApp).toBe('function')
    expect(typeof methods.infoByApp).toBe('function')
  })
})
