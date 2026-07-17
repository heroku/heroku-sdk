/* eslint-disable camelcase */
import type {Domain} from '@heroku/types/3.sdk'

import {
  afterEach, describe, expect, it, vi,
} from 'vitest'

import type {ResourceCtx} from '../../../core/extend-resource.js'

import {buildDomain, buildSniEndpoint} from '../domain/test-utils.js'
import {createAndAssociate} from './create-and-associate.js'

// Local ctx helper: the shared domain test-utils buildCtx does not stub
// sniEndpoint.create or domain.update, so build a self-contained one here.
// withOptions returns the same platform so signal-scoped calls hit the same stubs.
function buildCtx(stubs: {
  domainInfo?: ReturnType<typeof vi.fn>
  domainList?: ReturnType<typeof vi.fn>
  domainUpdate?: ReturnType<typeof vi.fn>
  sniEndpointCreate?: ReturnType<typeof vi.fn>
} = {}): ResourceCtx {
  const platform = {
    domain: {
      info: stubs.domainInfo ?? vi.fn().mockResolvedValue({}),
      list: stubs.domainList ?? vi.fn().mockResolvedValue([]),
      update: stubs.domainUpdate ?? vi.fn().mockResolvedValue({}),
    },
    sniEndpoint: {
      create: stubs.sniEndpointCreate ?? vi.fn().mockResolvedValue({}),
    },
    withOptions: vi.fn(function (this: unknown) {
      return this
    }),
  }
  platform.withOptions.mockReturnValue(platform)

  return {
    data: {} as never,
    platform: platform as never,
  }
}

// A ready (succeeded) domain so waitForReady returns without polling.
function readyDomain(overrides: Partial<Domain> = {}): Domain {
  return buildDomain({status: 'succeeded', ...overrides})
}

describe('createAndAssociate', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('creates the endpoint, matches domains, and associates the selected ones', async () => {
    const sniEndpoint = buildSniEndpoint({
      name: 'tokyo-1234',
      ssl_cert: {...buildSniEndpoint().ssl_cert, cert_domains: ['www.example.com']},
    })
    const appDomains = [
      readyDomain({hostname: 'www.example.com', id: 'd1'}),
      readyDomain({hostname: 'api.example.com', id: 'd2'}),
    ]
    const create = vi.fn().mockResolvedValue(sniEndpoint)
    const list = vi.fn().mockResolvedValue(appDomains)
    const update = vi.fn().mockResolvedValue({})
    const ctx = buildCtx({domainList: list, domainUpdate: update, sniEndpointCreate: create})

    const resolveDomains = vi.fn().mockResolvedValue(['www.example.com'])

    const result = await createAndAssociate(ctx, 'my-app', 'CERT_CHAIN', 'PRIVATE_KEY', {resolveDomains})

    expect(create).toHaveBeenCalledWith('my-app', {certificate_chain: 'CERT_CHAIN', private_key: 'PRIVATE_KEY'})
    expect(resolveDomains).toHaveBeenCalledWith(['www.example.com'])
    expect(update).toHaveBeenCalledExactlyOnceWith('my-app', 'www.example.com', {sni_endpoint: 'tokyo-1234'})
    expect(result).toEqual(sniEndpoint)
  })

  it('wildcard-matches app domains against the cert domains', async () => {
    const sniEndpoint = buildSniEndpoint({
      name: 'tokyo-1234',
      ssl_cert: {...buildSniEndpoint().ssl_cert, cert_domains: ['*.example.com']},
    })
    const appDomains = [
      readyDomain({hostname: 'www.example.com', id: 'd1'}),
      readyDomain({hostname: 'api.example.com', id: 'd2'}),
      readyDomain({hostname: 'other.example.org', id: 'd3'}),
    ]
    const create = vi.fn().mockResolvedValue(sniEndpoint)
    const list = vi.fn().mockResolvedValue(appDomains)
    const update = vi.fn().mockResolvedValue({})
    const ctx = buildCtx({domainList: list, domainUpdate: update, sniEndpointCreate: create})

    const resolveDomains = vi.fn().mockResolvedValue([])

    await createAndAssociate(ctx, 'my-app', 'CERT_CHAIN', 'PRIVATE_KEY', {resolveDomains})

    expect(resolveDomains).toHaveBeenCalledWith(['www.example.com', 'api.example.com'])
  })

  it('exact-matches non-wildcard cert domains only', async () => {
    const sniEndpoint = buildSniEndpoint({
      name: 'tokyo-1234',
      ssl_cert: {...buildSniEndpoint().ssl_cert, cert_domains: ['www.example.com']},
    })
    const appDomains = [
      readyDomain({hostname: 'www.example.com', id: 'd1'}),
      readyDomain({hostname: 'api.example.com', id: 'd2'}),
    ]
    const create = vi.fn().mockResolvedValue(sniEndpoint)
    const list = vi.fn().mockResolvedValue(appDomains)
    const ctx = buildCtx({domainList: list, sniEndpointCreate: create})

    const resolveDomains = vi.fn().mockResolvedValue([])

    await createAndAssociate(ctx, 'my-app', 'CERT_CHAIN', 'PRIVATE_KEY', {resolveDomains})

    expect(resolveDomains).toHaveBeenCalledWith(['www.example.com'])
  })

  it('skips resolveDomains and association when nothing matches', async () => {
    const sniEndpoint = buildSniEndpoint({
      name: 'tokyo-1234',
      ssl_cert: {...buildSniEndpoint().ssl_cert, cert_domains: ['www.example.com']},
    })
    const appDomains = [readyDomain({hostname: 'unrelated.example.org', id: 'd1'})]
    const create = vi.fn().mockResolvedValue(sniEndpoint)
    const list = vi.fn().mockResolvedValue(appDomains)
    const update = vi.fn().mockResolvedValue({})
    const ctx = buildCtx({domainList: list, domainUpdate: update, sniEndpointCreate: create})

    const resolveDomains = vi.fn()

    const result = await createAndAssociate(ctx, 'my-app', 'CERT_CHAIN', 'PRIVATE_KEY', {resolveDomains})

    expect(resolveDomains).not.toHaveBeenCalled()
    expect(update).not.toHaveBeenCalled()
    expect(result).toEqual(sniEndpoint)
  })

  it('associates only the subset selected by resolveDomains', async () => {
    const sniEndpoint = buildSniEndpoint({
      name: 'tokyo-1234',
      ssl_cert: {...buildSniEndpoint().ssl_cert, cert_domains: ['*.example.com']},
    })
    const appDomains = [
      readyDomain({hostname: 'www.example.com', id: 'd1'}),
      readyDomain({hostname: 'api.example.com', id: 'd2'}),
    ]
    const create = vi.fn().mockResolvedValue(sniEndpoint)
    const list = vi.fn().mockResolvedValue(appDomains)
    const update = vi.fn().mockResolvedValue({})
    const ctx = buildCtx({domainList: list, domainUpdate: update, sniEndpointCreate: create})

    const resolveDomains = vi.fn().mockResolvedValue(['api.example.com'])

    await createAndAssociate(ctx, 'my-app', 'CERT_CHAIN', 'PRIVATE_KEY', {resolveDomains})

    expect(update).toHaveBeenCalledExactlyOnceWith('my-app', 'api.example.com', {sni_endpoint: 'tokyo-1234'})
  })

  it('associates every selected domain in the fan-out', async () => {
    const sniEndpoint = buildSniEndpoint({
      name: 'tokyo-1234',
      ssl_cert: {...buildSniEndpoint().ssl_cert, cert_domains: ['*.example.com']},
    })
    const appDomains = [
      readyDomain({hostname: 'www.example.com', id: 'd1'}),
      readyDomain({hostname: 'api.example.com', id: 'd2'}),
    ]
    const create = vi.fn().mockResolvedValue(sniEndpoint)
    const list = vi.fn().mockResolvedValue(appDomains)
    const update = vi.fn().mockResolvedValue({})
    const ctx = buildCtx({domainList: list, domainUpdate: update, sniEndpointCreate: create})

    const resolveDomains = vi.fn().mockResolvedValue(['www.example.com', 'api.example.com'])

    await createAndAssociate(ctx, 'my-app', 'CERT_CHAIN', 'PRIVATE_KEY', {resolveDomains})

    expect(update).toHaveBeenCalledTimes(2)
    expect(update).toHaveBeenCalledWith('my-app', 'www.example.com', {sni_endpoint: 'tokyo-1234'})
    expect(update).toHaveBeenCalledWith('my-app', 'api.example.com', {sni_endpoint: 'tokyo-1234'})
  })

  it('makes no association calls when resolveDomains returns an empty selection', async () => {
    const sniEndpoint = buildSniEndpoint({
      name: 'tokyo-1234',
      ssl_cert: {...buildSniEndpoint().ssl_cert, cert_domains: ['*.example.com']},
    })
    const appDomains = [readyDomain({hostname: 'www.example.com', id: 'd1'})]
    const create = vi.fn().mockResolvedValue(sniEndpoint)
    const list = vi.fn().mockResolvedValue(appDomains)
    const update = vi.fn().mockResolvedValue({})
    const ctx = buildCtx({domainList: list, domainUpdate: update, sniEndpointCreate: create})

    const resolveDomains = vi.fn().mockResolvedValue([])

    await createAndAssociate(ctx, 'my-app', 'CERT_CHAIN', 'PRIVATE_KEY', {resolveDomains})

    expect(resolveDomains).toHaveBeenCalledOnce()
    expect(update).not.toHaveBeenCalled()
  })

  it('propagates a resolveDomains rejection and makes no association calls', async () => {
    const sniEndpoint = buildSniEndpoint({
      name: 'tokyo-1234',
      ssl_cert: {...buildSniEndpoint().ssl_cert, cert_domains: ['*.example.com']},
    })
    const appDomains = [readyDomain({hostname: 'www.example.com', id: 'd1'})]
    const create = vi.fn().mockResolvedValue(sniEndpoint)
    const list = vi.fn().mockResolvedValue(appDomains)
    const update = vi.fn().mockResolvedValue({})
    const ctx = buildCtx({domainList: list, domainUpdate: update, sniEndpointCreate: create})

    const resolveDomains = vi.fn().mockRejectedValue(new Error('User cancelled'))

    await expect(createAndAssociate(ctx, 'my-app', 'CERT_CHAIN', 'PRIVATE_KEY', {resolveDomains})).rejects.toThrow('User cancelled')
    expect(update).not.toHaveBeenCalled()
  })

  it('throws immediately if the signal is already aborted, before creating', async () => {
    const create = vi.fn()
    const ctx = buildCtx({sniEndpointCreate: create})
    const controller = new AbortController()
    controller.abort()

    const resolveDomains = vi.fn()

    await expect(createAndAssociate(ctx, 'my-app', 'CERT_CHAIN', 'PRIVATE_KEY', {resolveDomains, signal: controller.signal})).rejects.toThrow()
    expect(create).not.toHaveBeenCalled()
    expect(resolveDomains).not.toHaveBeenCalled()
  })

  it('threads the signal through withOptions when provided', async () => {
    const sniEndpoint = buildSniEndpoint({
      ssl_cert: {...buildSniEndpoint().ssl_cert, cert_domains: []},
    })
    const create = vi.fn().mockResolvedValue(sniEndpoint)
    const list = vi.fn().mockResolvedValue([])
    const ctx = buildCtx({domainList: list, sniEndpointCreate: create})
    const controller = new AbortController()

    const resolveDomains = vi.fn()

    await createAndAssociate(ctx, 'my-app', 'CERT_CHAIN', 'PRIVATE_KEY', {resolveDomains, signal: controller.signal})

    // @ts-expect-error — withOptions is on the mocked platform but not in the public type.
    expect(ctx.platform.withOptions).toHaveBeenCalledWith({signal: controller.signal})
  })

  it('creates the endpoint before making any association calls', async () => {
    const calls: string[] = []
    const sniEndpoint = buildSniEndpoint({
      name: 'tokyo-1234',
      ssl_cert: {...buildSniEndpoint().ssl_cert, cert_domains: ['www.example.com']},
    })
    const appDomains = [readyDomain({hostname: 'www.example.com', id: 'd1'})]
    const create = vi.fn(async () => {
      calls.push('create')
      return sniEndpoint
    })
    const list = vi.fn().mockResolvedValue(appDomains)
    const update = vi.fn(async () => {
      calls.push('update')
      return {} as Domain
    })
    const ctx = buildCtx({domainList: list, domainUpdate: update, sniEndpointCreate: create})

    const resolveDomains = vi.fn(async (candidates: string[]) => {
      calls.push('resolve')
      return candidates
    })

    await createAndAssociate(ctx, 'my-app', 'CERT_CHAIN', 'PRIVATE_KEY', {resolveDomains})

    expect(calls).toEqual(['create', 'resolve', 'update'])
  })

  it('waits for domain readiness before listing app domains for matching', async () => {
    // A pending domain forces waitForReady to poll domain.info until it resolves.
    const sniEndpoint = buildSniEndpoint({
      name: 'tokyo-1234',
      ssl_cert: {...buildSniEndpoint().ssl_cert, cert_domains: ['www.example.com']},
    })
    const pending = buildDomain({hostname: 'www.example.com', id: 'd1', status: 'pending'})
    const ready = buildDomain({hostname: 'www.example.com', id: 'd1', status: 'succeeded'})
    const create = vi.fn().mockResolvedValue(sniEndpoint)
    const list = vi.fn().mockResolvedValue([pending])
    const info = vi.fn().mockResolvedValue(ready)
    const update = vi.fn().mockResolvedValue({})
    const ctx = buildCtx({
      domainInfo: info, domainList: list, domainUpdate: update, sniEndpointCreate: create,
    })

    const resolveDomains = vi.fn().mockResolvedValue(['www.example.com'])

    await createAndAssociate(ctx, 'my-app', 'CERT_CHAIN', 'PRIVATE_KEY', {intervalMs: 1, resolveDomains})

    expect(info).toHaveBeenCalled()
    expect(update).toHaveBeenCalledExactlyOnceWith('my-app', 'www.example.com', {sni_endpoint: 'tokyo-1234'})
  })
})
