/* eslint-disable camelcase */
import {
  afterEach, describe, expect, it, vi,
} from 'vitest'

import {createAndWait} from './index.js'
import {buildCtx, buildDomain, buildSniEndpoint} from './test-utils.js'

// Used to avoid timeouts in tests
const WAIT_INTERVAL_MS = 5

describe('createAndWait', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('creates domain with explicit sniEndpoint', async () => {
    const domain = buildDomain({hostname: 'example.com', status: 'succeeded'})

    const ctx = buildCtx({
      domainCreate: vi.fn().mockResolvedValue(domain),
    })

    const result = await createAndWait(ctx, 'test-app', 'example.com', {sniEndpoint: 'tokyo-5678'})

    expect(result).toEqual(domain)
    expect(ctx.platform.sniEndpoint.list).not.toHaveBeenCalled()
    expect(ctx.platform.domain.create).toHaveBeenCalledWith('test-app', {
      hostname: 'example.com',
      sni_endpoint: 'tokyo-5678',
    })
  })

  it('uses null when no SNI endpoints exist', async () => {
    const domain = buildDomain({hostname: 'example.com', status: 'succeeded'})

    const ctx = buildCtx({
      domainCreate: vi.fn().mockResolvedValue(domain),
      sniEndpointList: vi.fn().mockResolvedValue([]),
    })

    const result = await createAndWait(ctx, 'test-app', 'example.com')

    expect(result).toEqual(domain)
    expect(ctx.platform.sniEndpoint.list).toHaveBeenCalledWith('test-app')
    expect(ctx.platform.domain.create).toHaveBeenCalledWith('test-app', {
      hostname: 'example.com',
      sni_endpoint: null,
    })
  })

  it('leaves sni_endpoint null when only one SNI endpoint exists', async () => {
    const sniEndpoint = buildSniEndpoint({id: 'sni-456', name: 'tokyo-1234'})
    const domain = buildDomain({hostname: 'example.com', status: 'succeeded'})

    const ctx = buildCtx({
      domainCreate: vi.fn().mockResolvedValue(domain),
      sniEndpointList: vi.fn().mockResolvedValue([sniEndpoint]),
    })

    const result = await createAndWait(ctx, 'test-app', 'example.com')

    expect(result).toEqual(domain)
    expect(ctx.platform.domain.create).toHaveBeenCalledWith('test-app', {
      hostname: 'example.com',
      sni_endpoint: null,
    })
  })

  it('does not invoke callback when only one SNI endpoint exists', async () => {
    const sniEndpoint = buildSniEndpoint({id: 'sni-456', name: 'tokyo-1234'})
    const domain = buildDomain({hostname: 'example.com', status: 'succeeded'})

    const ctx = buildCtx({
      domainCreate: vi.fn().mockResolvedValue(domain),
      sniEndpointList: vi.fn().mockResolvedValue([sniEndpoint]),
    })

    const resolveSniEndpoint = vi.fn().mockResolvedValue('tokyo-1234')

    await createAndWait(ctx, 'test-app', 'example.com', {resolveSniEndpoint})

    expect(resolveSniEndpoint).not.toHaveBeenCalled()
  })

  it('invokes resolveSniEndpoint when multiple endpoints exist', async () => {
    const sni1 = buildSniEndpoint({domains: ['example.com'], id: 'sni-1', name: 'tokyo-1234'})
    const sni2 = buildSniEndpoint({domains: ['test.com'], id: 'sni-2', name: 'osaka-5678'})
    const domain = buildDomain({hostname: 'example.com', status: 'succeeded'})

    const ctx = buildCtx({
      domainCreate: vi.fn().mockResolvedValue(domain),
      sniEndpointList: vi.fn().mockResolvedValue([sni1, sni2]),
    })

    const resolveSniEndpoint = vi.fn().mockResolvedValue('osaka-5678')

    const result = await createAndWait(ctx, 'test-app', 'example.com', {resolveSniEndpoint})

    expect(result).toEqual(domain)
    expect(resolveSniEndpoint).toHaveBeenCalledWith([sni1, sni2])
    expect(ctx.platform.domain.create).toHaveBeenCalledWith('test-app', {
      hostname: 'example.com',
      sni_endpoint: 'osaka-5678',
    })
  })

  it('uses null when multiple endpoints exist and no resolver is provided', async () => {
    const sni1 = buildSniEndpoint({id: 'sni-1', name: 'tokyo-1234'})
    const sni2 = buildSniEndpoint({id: 'sni-2', name: 'osaka-5678'})
    const domain = buildDomain({hostname: 'example.com', status: 'succeeded'})

    const ctx = buildCtx({
      domainCreate: vi.fn().mockResolvedValue(domain),
      sniEndpointList: vi.fn().mockResolvedValue([sni1, sni2]),
    })

    const result = await createAndWait(ctx, 'test-app', 'example.com')

    expect(result).toEqual(domain)
    expect(ctx.platform.domain.create).toHaveBeenCalledWith('test-app', {
      hostname: 'example.com',
      sni_endpoint: null,
    })
  })

  it('uses null when callback returns undefined', async () => {
    const sni1 = buildSniEndpoint({id: 'sni-1', name: 'tokyo-1234'})
    const sni2 = buildSniEndpoint({id: 'sni-2', name: 'osaka-5678'})
    const domain = buildDomain({hostname: 'example.com', status: 'succeeded'})

    const ctx = buildCtx({
      domainCreate: vi.fn().mockResolvedValue(domain),
      sniEndpointList: vi.fn().mockResolvedValue([sni1, sni2]),
    })

    const resolveSniEndpoint = vi.fn()

    const result = await createAndWait(ctx, 'test-app', 'example.com', {resolveSniEndpoint})

    expect(result).toEqual(domain)
    expect(ctx.platform.domain.create).toHaveBeenCalledWith('test-app', {
      hostname: 'example.com',
      sni_endpoint: null,
    })
  })

  it('returns immediately when wait is false', async () => {
    const sniEndpoint = buildSniEndpoint()
    const domain = buildDomain({hostname: 'example.com', status: 'pending'})

    const ctx = buildCtx({
      domainCreate: vi.fn().mockResolvedValue(domain),
      sniEndpointList: vi.fn().mockResolvedValue([sniEndpoint]),
    })

    const result = await createAndWait(ctx, 'test-app', 'example.com', {wait: false})

    expect(result).toEqual(domain)
    expect(ctx.platform.domain.info).not.toHaveBeenCalled()
  })

  it('waits for domain when wait is true and status is pending', async () => {
    const sniEndpoint = buildSniEndpoint()
    const pending = buildDomain({hostname: 'example.com', id: 'domain-123', status: 'pending'})
    const ready = buildDomain({hostname: 'example.com', id: 'domain-123', status: 'succeeded'})

    const ctx = buildCtx({
      domainCreate: vi.fn().mockResolvedValue(pending),
      domainInfo: vi.fn().mockResolvedValueOnce(ready),
      sniEndpointList: vi.fn().mockResolvedValue([sniEndpoint]),
    })

    const result = await createAndWait(ctx, 'test-app', 'example.com', {
      wait: true,
      waitIntervalMs: WAIT_INTERVAL_MS,
    })

    expect(result).toEqual(ready)
    expect(ctx.platform.domain.info).toHaveBeenCalled()
  })

  it('does not wait when domain status is already succeeded', async () => {
    const sniEndpoint = buildSniEndpoint()
    const domain = buildDomain({hostname: 'example.com', status: 'succeeded'})

    const ctx = buildCtx({
      domainCreate: vi.fn().mockResolvedValue(domain),
      sniEndpointList: vi.fn().mockResolvedValue([sniEndpoint]),
    })

    const result = await createAndWait(ctx, 'test-app', 'example.com', {wait: true})

    expect(result).toEqual(domain)
    expect(ctx.platform.domain.info).not.toHaveBeenCalled()
  })

  it('does not wait when domain status is already none', async () => {
    const sniEndpoint = buildSniEndpoint()
    const domain = buildDomain({hostname: 'example.com', status: 'none'})

    const ctx = buildCtx({
      domainCreate: vi.fn().mockResolvedValue(domain),
      sniEndpointList: vi.fn().mockResolvedValue([sniEndpoint]),
    })

    const result = await createAndWait(ctx, 'test-app', 'example.com', {wait: true})

    expect(result).toEqual(domain)
    expect(ctx.platform.domain.info).not.toHaveBeenCalled()
  })

  it('throws if create operation fails', async () => {
    const ctx = buildCtx({
      domainCreate: vi.fn().mockRejectedValue(new Error('create failed')),
      sniEndpointList: vi.fn().mockResolvedValue([]),
    })

    await expect(createAndWait(ctx, 'test-app', 'example.com')).rejects.toThrow('create failed')
    expect(ctx.platform.domain.create).toHaveBeenCalledTimes(1)
  })

  it('throws when sniEndpoint.list fails', async () => {
    const ctx = buildCtx({
      sniEndpointList: vi.fn().mockRejectedValue(new Error('SNI list failed')),
    })

    await expect(createAndWait(ctx, 'test-app', 'example.com')).rejects.toThrow('SNI list failed')
    expect(ctx.platform.sniEndpoint.list).toHaveBeenCalledTimes(1)
    expect(ctx.platform.domain.create).not.toHaveBeenCalled()
  })

  it('throws when resolveSniEndpoint callback throws', async () => {
    const sni1 = buildSniEndpoint({id: 'sni-1', name: 'tokyo-1234'})
    const sni2 = buildSniEndpoint({id: 'sni-2', name: 'osaka-5678'})

    const ctx = buildCtx({
      sniEndpointList: vi.fn().mockResolvedValue([sni1, sni2]),
    })

    const resolveSniEndpoint = vi.fn().mockRejectedValue(new Error('User cancelled'))

    await expect(createAndWait(ctx, 'test-app', 'example.com', {resolveSniEndpoint})).rejects.toThrow('User cancelled')
    expect(ctx.platform.domain.create).not.toHaveBeenCalled()
  })

  it('stops on signal abort before any API calls', async () => {
    const ctx = buildCtx()
    const controller = new AbortController()
    controller.abort()

    await expect(createAndWait(ctx, 'test-app', 'example.com', {signal: controller.signal})).rejects.toThrow()

    expect(ctx.platform.sniEndpoint.list).not.toHaveBeenCalled()
    expect(ctx.platform.domain.create).not.toHaveBeenCalled()
  })

  it('threads the signal through withOptions when provided', async () => {
    const domain = buildDomain({status: 'succeeded'})
    const ctx = buildCtx({
      domainCreate: vi.fn().mockResolvedValue(domain),
      sniEndpointList: vi.fn().mockResolvedValue([]),
    })
    const controller = new AbortController()

    await createAndWait(ctx, 'test-app', 'example.com', {signal: controller.signal})

    expect(ctx.platform.withOptions).toHaveBeenCalledExactlyOnceWith({signal: controller.signal})
  })

  it('does not call withOptions when no signal is provided', async () => {
    const domain = buildDomain({status: 'succeeded'})
    const ctx = buildCtx({
      domainCreate: vi.fn().mockResolvedValue(domain),
      sniEndpointList: vi.fn().mockResolvedValue([]),
    })

    await createAndWait(ctx, 'test-app', 'example.com')

    expect(ctx.platform.withOptions).not.toHaveBeenCalled()
  })

  it('propagates signal to waitForReady when wait is true', async () => {
    const sniEndpoint = buildSniEndpoint()
    const pending = buildDomain({hostname: 'example.com', id: 'domain-123', status: 'pending'})
    const ready = buildDomain({hostname: 'example.com', id: 'domain-123', status: 'succeeded'})
    const controller = new AbortController()

    const ctx = buildCtx({
      domainCreate: vi.fn().mockResolvedValue(pending),
      domainInfo: vi.fn().mockResolvedValueOnce(ready),
      sniEndpointList: vi.fn().mockResolvedValue([sniEndpoint]),
    })

    await createAndWait(ctx, 'test-app', 'example.com', {
      signal: controller.signal,
      wait: true,
      waitIntervalMs: WAIT_INTERVAL_MS,
    })

    // Signal should be passed to withOptions twice: once for create flow, once for wait flow
    expect(ctx.platform.withOptions).toHaveBeenNthCalledWith(1, {signal: controller.signal})
    expect(ctx.platform.withOptions).toHaveBeenNthCalledWith(2, {signal: controller.signal})
  })
})
