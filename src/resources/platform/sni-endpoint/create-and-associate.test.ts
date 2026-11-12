/* eslint-disable camelcase */
import type {Domain} from '@heroku/types/3.sdk'

import {readFileSync} from 'node:fs'
import {
  afterEach, describe, expect, it, vi,
} from 'vitest'

import type {ResourceCtx} from '../../../core/extend-resource.js'

import {buildDomain, buildSniEndpoint} from '../domain/test-utils.js'
import {CertificateDomainsMismatchError} from './certificate-domains.js'
import {createAndAssociate, SniEndpointAssociationError} from './create-and-associate.js'

// Fake, expired, self-signed test certificate covering www.example.com and *.api.example.com.
const sanCert = readFileSync(new URL('fixtures/san.pem', import.meta.url), 'utf8')

// Local ctx helper: the shared domain test-utils buildCtx does not stub
// sniEndpoint.create or domain.update, so build a self-contained one here.
// withOptions returns the same platform so signal-scoped calls hit the same stubs.
function buildCtx(stubs: {
  domainInfo?: ReturnType<typeof vi.fn>
  domainList?: ReturnType<typeof vi.fn>
  domainUpdate?: ReturnType<typeof vi.fn>
  sniEndpointCreate?: ReturnType<typeof vi.fn>
  sniEndpointInfo?: ReturnType<typeof vi.fn>
} = {}): ResourceCtx {
  const platform = {
    domain: {
      info: stubs.domainInfo ?? vi.fn().mockResolvedValue({}),
      list: stubs.domainList ?? vi.fn().mockResolvedValue([]),
      update: stubs.domainUpdate ?? vi.fn().mockResolvedValue({}),
    },
    sniEndpoint: {
      create: stubs.sniEndpointCreate ?? vi.fn().mockResolvedValue({}),
      info: stubs.sniEndpointInfo ?? vi.fn().mockResolvedValue({}),
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
    const associated = {...sniEndpoint, domains: ['d1']}
    const info = vi.fn().mockResolvedValue(associated)
    const ctx = buildCtx({
      domainList: list, domainUpdate: update, sniEndpointCreate: create, sniEndpointInfo: info,
    })

    const resolveDomains = vi.fn().mockResolvedValue(['www.example.com'])

    const result = await createAndAssociate(ctx, 'my-app', 'CERT_CHAIN', 'PRIVATE_KEY', {resolveDomains})

    expect(create).toHaveBeenCalledWith('my-app', {certificate_chain: 'CERT_CHAIN', private_key: 'PRIVATE_KEY'})
    expect(resolveDomains).toHaveBeenCalledWith(['www.example.com'])
    expect(update).toHaveBeenCalledExactlyOnceWith('my-app', 'www.example.com', {sni_endpoint: 'tokyo-1234'})
    // Re-fetched after associating, so the result's domains include the new association.
    expect(info).toHaveBeenCalledExactlyOnceWith('my-app', sniEndpoint.id)
    expect(result).toEqual(associated)
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

  it('does not wildcard-match hostnames that merely share a prefix (security)', async () => {
    const sniEndpoint = buildSniEndpoint({
      name: 'tokyo-1234',
      ssl_cert: {...buildSniEndpoint().ssl_cert, cert_domains: ['*.example.com']},
    })
    const appDomains = [
      readyDomain({hostname: 'www.example.com', id: 'd1'}),
      readyDomain({hostname: 'www.example.com.evil.org', id: 'd2'}),
    ]
    const create = vi.fn().mockResolvedValue(sniEndpoint)
    const list = vi.fn().mockResolvedValue(appDomains)
    const update = vi.fn().mockResolvedValue({})
    const ctx = buildCtx({domainList: list, domainUpdate: update, sniEndpointCreate: create})

    const resolveDomains = vi.fn().mockResolvedValue([])

    await createAndAssociate(ctx, 'my-app', 'CERT_CHAIN', 'PRIVATE_KEY', {resolveDomains})

    expect(resolveDomains).toHaveBeenCalledWith(['www.example.com'])
  })

  it('does not wildcard-match the apex domain', async () => {
    const sniEndpoint = buildSniEndpoint({
      name: 'tokyo-1234',
      ssl_cert: {...buildSniEndpoint().ssl_cert, cert_domains: ['*.example.com']},
    })
    const appDomains = [
      readyDomain({hostname: 'www.example.com', id: 'd1'}),
      readyDomain({hostname: 'example.com', id: 'd2'}),
    ]
    const create = vi.fn().mockResolvedValue(sniEndpoint)
    const list = vi.fn().mockResolvedValue(appDomains)
    const update = vi.fn().mockResolvedValue({})
    const ctx = buildCtx({domainList: list, domainUpdate: update, sniEndpointCreate: create})

    const resolveDomains = vi.fn().mockResolvedValue([])

    await createAndAssociate(ctx, 'my-app', 'CERT_CHAIN', 'PRIVATE_KEY', {resolveDomains})

    expect(resolveDomains).toHaveBeenCalledWith(['www.example.com'])
  })

  it('exact-matches non-wildcard cert domains by string equality, excluding prefix-sharing hostnames', async () => {
    const sniEndpoint = buildSniEndpoint({
      name: 'tokyo-1234',
      ssl_cert: {...buildSniEndpoint().ssl_cert, cert_domains: ['test.com']},
    })
    const appDomains = [
      readyDomain({hostname: 'test.com', id: 'd1'}),
      readyDomain({hostname: 'test.com.evil.org', id: 'd2'}),
    ]
    const create = vi.fn().mockResolvedValue(sniEndpoint)
    const list = vi.fn().mockResolvedValue(appDomains)
    const ctx = buildCtx({domainList: list, sniEndpointCreate: create})

    const resolveDomains = vi.fn().mockResolvedValue([])

    await createAndAssociate(ctx, 'my-app', 'CERT_CHAIN', 'PRIVATE_KEY', {resolveDomains})

    expect(resolveDomains).toHaveBeenCalledWith(['test.com'])
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

  it('wraps a resolveDomains rejection in SniEndpointAssociationError and makes no association calls', async () => {
    const sniEndpoint = buildSniEndpoint({
      name: 'tokyo-1234',
      ssl_cert: {...buildSniEndpoint().ssl_cert, cert_domains: ['*.example.com']},
    })
    const appDomains = [readyDomain({hostname: 'www.example.com', id: 'd1'})]
    const create = vi.fn().mockResolvedValue(sniEndpoint)
    const list = vi.fn().mockResolvedValue(appDomains)
    const update = vi.fn().mockResolvedValue({})
    const ctx = buildCtx({domainList: list, domainUpdate: update, sniEndpointCreate: create})

    const cancelled = new Error('User cancelled')
    const resolveDomains = vi.fn().mockRejectedValue(cancelled)

    const error = await createAndAssociate(ctx, 'my-app', 'CERT_CHAIN', 'PRIVATE_KEY', {resolveDomains}).catch(error_ => error_)
    expect(error).toBeInstanceOf(SniEndpointAssociationError)
    expect(error.message).toBe('The certificate was uploaded to my-app as tokyo-1234, but associating it with domains failed: User cancelled')
    expect(error.sniEndpoint).toBe(sniEndpoint)
    expect(error.cause).toBe(cancelled)
    expect(update).not.toHaveBeenCalled()
  })

  it('names the uploaded endpoint when an association call fails', async () => {
    const sniEndpoint = buildSniEndpoint({name: 'tokyo-1234'})
    const create = vi.fn().mockResolvedValue(sniEndpoint)
    const list = vi.fn().mockResolvedValue([readyDomain({hostname: 'www.example.com', id: 'd1'})])
    const update = vi.fn().mockRejectedValue(new Error('Domain is locked.'))
    const ctx = buildCtx({domainList: list, domainUpdate: update, sniEndpointCreate: create})

    const error = await createAndAssociate(ctx, 'my-app', sanCert, 'PRIVATE_KEY', {domains: ['www.example.com']}).catch(error_ => error_)
    expect(error).toBeInstanceOf(SniEndpointAssociationError)
    expect(error.message).toContain('as tokyo-1234')
    expect(error.message).toContain('Domain is locked.')
  })

  it('rethrows an abort after upload as is, not wrapped', async () => {
    const controller = new AbortController()
    const sniEndpoint = buildSniEndpoint({name: 'tokyo-1234', ssl_cert: {...buildSniEndpoint().ssl_cert, cert_domains: ['www.example.com']}})
    const create = vi.fn().mockResolvedValue(sniEndpoint)
    const list = vi.fn().mockResolvedValue([readyDomain({hostname: 'www.example.com', id: 'd1'})])
    const ctx = buildCtx({domainList: list, sniEndpointCreate: create})
    const resolveDomains = vi.fn(async () => {
      controller.abort()
      throw controller.signal.reason
    })

    const error = await createAndAssociate(ctx, 'my-app', 'CERT_CHAIN', 'PRIVATE_KEY', {resolveDomains, signal: controller.signal}).catch(error_ => error_)
    expect(error).not.toBeInstanceOf(SniEndpointAssociationError)
    expect(error.name).toBe('AbortError')
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

  it('uses domainPoller when provided', async () => {
    const calls: string[] = []

    const sniEndpoint = buildSniEndpoint()
    const pending = buildDomain({status: 'pending'})
    const ready = buildDomain({status: 'succeeded'})

    const ctx = buildCtx({
      domainInfo: vi.fn().mockImplementation(async () => {
        calls.push('info')
        return ready
      }),
      domainList: vi.fn().mockResolvedValue([pending]),
      domainUpdate: vi.fn().mockResolvedValue({}),
      sniEndpointCreate: vi.fn().mockResolvedValue(sniEndpoint),
      sniEndpointInfo: vi.fn().mockResolvedValue(sniEndpoint),
    })

    const resolveDomains = vi.fn().mockResolvedValue(['www.example.com'])

    const onStart = vi.fn(() => calls.push('start'))
    const onStop = vi.fn(() => calls.push('stop'))

    const result = await createAndAssociate(ctx, 'my-app', 'CERT_CHAIN', 'PRIVATE_KEY', {
      domainPoller: {onStart, onStop},
      intervalMs: 1,
      resolveDomains,
    })

    expect(calls).toEqual([
      'start',
      'info',
      'stop',
    ])
    expect(onStart).toHaveBeenCalledOnce()
    expect(onStop).toHaveBeenCalledOnce()
    expect(result).toEqual(sniEndpoint)
  })

  describe('with domains', () => {
    const appDomains = [
      readyDomain({hostname: 'www.example.com', id: 'd1'}),
      readyDomain({hostname: 'v1.api.example.com', id: 'd2'}),
      readyDomain({hostname: 'shop.example.org', id: 'd3'}),
    ]

    it('associates exactly the requested hostnames and returns the re-fetched endpoint', async () => {
      const sniEndpoint = buildSniEndpoint({domains: [], name: 'tokyo-1234'})
      const associated = {...sniEndpoint, domains: ['d1', 'd2']}
      const update = vi.fn().mockResolvedValue({})
      const info = vi.fn().mockResolvedValue(associated)
      const ctx = buildCtx({
        domainList: vi.fn().mockResolvedValue(appDomains),
        domainUpdate: update,
        sniEndpointCreate: vi.fn().mockResolvedValue(sniEndpoint),
        sniEndpointInfo: info,
      })

      const result = await createAndAssociate(ctx, 'my-app', sanCert, 'PRIVATE_KEY', {domains: ['www.example.com', 'v1.api.example.com']})

      expect(update).toHaveBeenCalledTimes(2)
      expect(update).toHaveBeenCalledWith('my-app', 'www.example.com', {sni_endpoint: 'tokyo-1234'})
      expect(update).toHaveBeenCalledWith('my-app', 'v1.api.example.com', {sni_endpoint: 'tokyo-1234'})
      expect(info).toHaveBeenCalledExactlyOnceWith('my-app', sniEndpoint.id)
      expect(result).toEqual(associated)
    })

    it('associates none, without checking or re-fetching, for domains: []', async () => {
      const sniEndpoint = buildSniEndpoint()
      const list = vi.fn().mockResolvedValue([])
      const update = vi.fn()
      const info = vi.fn()
      const ctx = buildCtx({
        domainList: list, domainUpdate: update, sniEndpointCreate: vi.fn().mockResolvedValue(sniEndpoint), sniEndpointInfo: info,
      })

      // Not a parseable certificate: domains: [] never reads it.
      const result = await createAndAssociate(ctx, 'my-app', 'CERT_CHAIN', 'PRIVATE_KEY', {domains: []})

      expect(update).not.toHaveBeenCalled()
      expect(info).not.toHaveBeenCalled()
      expect(result).toEqual(sniEndpoint)
    })

    it('throws before uploading when a hostname is not on the app or not covered by the certificate', async () => {
      const create = vi.fn()
      const ctx = buildCtx({domainList: vi.fn().mockResolvedValue(appDomains), sniEndpointCreate: create})

      const error = await createAndAssociate(ctx, 'my-app', sanCert, 'PRIVATE_KEY', {
        domains: ['www.example.com', 'typo.example.com', 'shop.example.org'],
      }).catch((error_: unknown) => error_)

      expect(error).toBeInstanceOf(CertificateDomainsMismatchError)
      expect(error).toMatchObject({
        message: 'Can\'t associate the certificate: typo.example.com isn\'t a domain on my-app; shop.example.org isn\'t covered by the certificate. Nothing was uploaded.',
        notCovered: ['shop.example.org'],
        notOnApp: ['typo.example.com'],
      })
      expect(create).not.toHaveBeenCalled()
    })

    it('throws before uploading when the certificate cannot be read', async () => {
      const create = vi.fn()
      const ctx = buildCtx({domainList: vi.fn().mockResolvedValue(appDomains), sniEndpointCreate: create})

      await expect(createAndAssociate(ctx, 'my-app', 'CERT_CHAIN', 'PRIVATE_KEY', {domains: ['www.example.com']})).rejects.toThrow()
      expect(create).not.toHaveBeenCalled()
    })
  })
})
