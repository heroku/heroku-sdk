import {
  afterEach, describe, expect, it, vi,
} from 'vitest'

import {clearCustomDomains} from './index.js'
import {buildCtx, buildDomain} from './test-utils.js'

describe('clearCustomDomains', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('deletes all custom domains', async () => {
    const ctx = buildCtx({
      domainList: vi.fn().mockResolvedValue([
        buildDomain({hostname: 'one.com', kind: 'custom'}),
        buildDomain({hostname: 'two.com', kind: 'custom'}),
        buildDomain({hostname: 'three.com', kind: 'custom'}),
      ]),
    })

    await clearCustomDomains(ctx, 'test-app')

    const deleteStub = ctx.platform.domain.delete
    expect(deleteStub).toHaveBeenCalledTimes(3)
    expect(deleteStub).toHaveBeenNthCalledWith(1, 'test-app', 'one.com')
    expect(deleteStub).toHaveBeenNthCalledWith(2, 'test-app', 'two.com')
    expect(deleteStub).toHaveBeenNthCalledWith(3, 'test-app', 'three.com')
  })

  it('skips heroku-owned domains', async () => {
    const ctx = buildCtx({
      domainList: vi.fn().mockResolvedValue([
        buildDomain({hostname: 'app.herokuapp.com', kind: 'heroku'}),
        buildDomain({hostname: 'test.herokuapp.com', kind: 'heroku'}),
        buildDomain({hostname: 'example.com', kind: 'custom'}),
      ]),
    })

    await clearCustomDomains(ctx, 'test-app')

    const deleteStub = ctx.platform.domain.delete
    expect(deleteStub).toHaveBeenCalledTimes(1)
    expect(deleteStub).toHaveBeenCalledWith('test-app', 'example.com')
  })

  it('throws if the list operation fails', async () => {
    const ctx = buildCtx({
      domainList: vi.fn().mockRejectedValue(new Error('list failed')),
    })

    await expect(clearCustomDomains(ctx, 'test-app')).rejects.toThrow('list failed')
    expect(ctx.platform.domain.list).toHaveBeenCalledTimes(1)
    expect(ctx.platform.domain.delete).not.toHaveBeenCalled()
  })

  it('throws if the delete operation fails', async () => {
    const ctx = buildCtx({
      domainDelete: vi.fn().mockRejectedValue(new Error('delete failed')),
      domainList: vi.fn().mockResolvedValue([
        buildDomain({hostname: 'example.com', kind: 'custom'}),
      ]),
    })

    await expect(clearCustomDomains(ctx, 'test-app')).rejects.toThrow('delete failed')
    expect(ctx.platform.domain.list).toHaveBeenCalledTimes(1)
    expect(ctx.platform.domain.delete).toHaveBeenCalledTimes(1)
  })

  it('stops on signal abort before delete, without calling any route', async () => {
    const ctx = buildCtx()
    const controller = new AbortController()
    controller.abort()

    await expect(clearCustomDomains(ctx, 'my-app', {signal: controller.signal})).rejects.toThrow()
    expect(ctx.platform.domain.list).not.toHaveBeenCalled()
    expect(ctx.platform.domain.delete).not.toHaveBeenCalled()
  })

  it('stops on signal abort mid-delete', async () => {
    const controller = new AbortController()
    let callCount = 0

    const ctx = buildCtx({
      domainDelete: vi.fn().mockImplementation(() => {
        callCount++
        if (callCount === 2) {
          controller.abort()
        }

        return Promise.resolve({})
      }),
      domainList: vi.fn().mockResolvedValue([
        buildDomain({hostname: 'one.com', kind: 'custom'}),
        buildDomain({hostname: 'two.com', kind: 'custom'}),
        buildDomain({hostname: 'three.com', kind: 'custom'}),
      ]),
    })

    await expect(clearCustomDomains(ctx, 'test-app', {signal: controller.signal})).rejects.toThrow()
    expect(ctx.platform.domain.delete).toHaveBeenCalledTimes(2)
  })

  it('threads the signal through withOptions when provided', async () => {
    const ctx = buildCtx()
    const controller = new AbortController()

    await clearCustomDomains(ctx, 'my-app', {signal: controller.signal})

    expect(ctx.platform.withOptions).toHaveBeenCalledExactlyOnceWith({signal: controller.signal})
  })

  it('does not call withOptions when no signal is provided', async () => {
    const ctx = buildCtx()

    await clearCustomDomains(ctx, 'my-app')

    expect(ctx.platform.withOptions).not.toHaveBeenCalled()
  })
})
