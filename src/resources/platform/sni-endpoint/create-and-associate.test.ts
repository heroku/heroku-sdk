/* eslint-disable camelcase */
import type {Domain} from '@heroku/types/3.sdk'

import {readFileSync} from 'node:fs'
import {
  afterEach, describe, expect, it, vi,
} from 'vitest'

import type {ResourceCtx} from '../../../core/extend-resource.js'

import {buildDomain, buildSniEndpoint} from '../domain/test-utils.js'
import {CertificateDomainsMismatchError, CertificateDomainsRequiredError, CertificateParseError} from './certificate-domains.js'
import {createAndAssociate, SniEndpointAssociationError} from './create-and-associate.js'

// Fake, expired, self-signed test certificate covering www.example.com and *.api.example.com.
const sanCert = readFileSync(new URL('fixtures/san.pem', import.meta.url), 'utf8')
const certificate = {certificateChain: sanCert, privateKey: 'PRIVATE_KEY'}

// Local ctx helper: the shared domain test-utils buildCtx does not stub
// sniEndpoint.create or domain.update, so build a self-contained one here.
// withOptions returns the same platform so signal-scoped calls hit the same stubs.
function buildCtx(stubs: {
  domainInfo?: ReturnType<typeof vi.fn>
  domainList?: ReturnType<typeof vi.fn>
  domainUpdate?: ReturnType<typeof vi.fn>
  sniEndpointCreate?: ReturnType<typeof vi.fn>
  sniEndpointInfo?: ReturnType<typeof vi.fn>
} = {}) {
  const platform = {
    domain: {
      info: stubs.domainInfo ?? vi.fn().mockResolvedValue({}),
      list: stubs.domainList ?? vi.fn().mockResolvedValue([]),
      update: stubs.domainUpdate ?? vi.fn().mockResolvedValue({}),
    },
    sniEndpoint: {
      create: stubs.sniEndpointCreate ?? vi.fn().mockResolvedValue(buildSniEndpoint({name: 'tokyo-1234'})),
      info: stubs.sniEndpointInfo ?? vi.fn().mockResolvedValue({}),
    },
    withOptions: vi.fn(),
  }
  platform.withOptions.mockReturnValue(platform)

  return {ctx: {data: {} as never, platform: platform as never} as ResourceCtx, platform}
}

// A ready (succeeded) domain so waitForReady returns without polling.
function readyDomain(overrides: Partial<Domain> = {}): Domain {
  return buildDomain({status: 'succeeded', ...overrides})
}

const appDomains = [
  readyDomain({hostname: 'www.example.com', id: 'd1'}),
  readyDomain({hostname: 'v1.api.example.com', id: 'd2'}),
  readyDomain({hostname: 'shop.example.org', id: 'd3'}),
]

describe('createAndAssociate', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('with resolveDomains', () => {
    it('creates the endpoint, offers the covered domains, associates the selected ones, and re-fetches', async () => {
      const sniEndpoint = buildSniEndpoint({name: 'tokyo-1234'})
      const associated = {...sniEndpoint, domains: ['d1']}
      const {ctx, platform} = buildCtx({
        domainList: vi.fn().mockResolvedValue([
          ...appDomains,
          readyDomain({hostname: 'a.b.api.example.com', id: 'd4'}),
          readyDomain({hostname: 'www.example.com.evil.org', id: 'd5'}),
        ]),
        sniEndpointCreate: vi.fn().mockResolvedValue(sniEndpoint),
        sniEndpointInfo: vi.fn().mockResolvedValue(associated),
      })
      const resolveDomains = vi.fn().mockResolvedValue(['www.example.com'])

      const result = await createAndAssociate(ctx, 'my-app', certificate, {resolveDomains})

      expect(platform.sniEndpoint.create).toHaveBeenCalledWith('my-app', {certificate_chain: sanCert, private_key: 'PRIVATE_KEY'})
      expect(resolveDomains).toHaveBeenCalledExactlyOnceWith(['www.example.com', 'v1.api.example.com'])
      expect(platform.domain.update).toHaveBeenCalledExactlyOnceWith('my-app', 'www.example.com', {sni_endpoint: 'tokyo-1234'})
      expect(platform.sniEndpoint.info).toHaveBeenCalledExactlyOnceWith('my-app', sniEndpoint.id)
      expect(result).toEqual(associated)
    })

    it('matches against the certificate\'s own names, not the API\'s cert_domains', async () => {
      const sniEndpoint = buildSniEndpoint({ssl_cert: {...buildSniEndpoint().ssl_cert, cert_domains: ['shop.example.org']}})
      const {ctx} = buildCtx({domainList: vi.fn().mockResolvedValue(appDomains), sniEndpointCreate: vi.fn().mockResolvedValue(sniEndpoint)})
      const resolveDomains = vi.fn().mockResolvedValue([])

      await createAndAssociate(ctx, 'my-app', certificate, {resolveDomains})

      expect(resolveDomains).toHaveBeenCalledExactlyOnceWith(['www.example.com', 'v1.api.example.com'])
    })

    it('skips resolveDomains, association, and the re-fetch when nothing is covered', async () => {
      const sniEndpoint = buildSniEndpoint()
      const {ctx, platform} = buildCtx({
        domainList: vi.fn().mockResolvedValue([readyDomain({hostname: 'unrelated.example.org'})]),
        sniEndpointCreate: vi.fn().mockResolvedValue(sniEndpoint),
      })
      const resolveDomains = vi.fn()

      const result = await createAndAssociate(ctx, 'my-app', certificate, {resolveDomains})

      expect(resolveDomains).not.toHaveBeenCalled()
      expect(platform.domain.update).not.toHaveBeenCalled()
      expect(platform.sniEndpoint.info).not.toHaveBeenCalled()
      expect(result).toBe(sniEndpoint)
    })

    it('associates every selected domain', async () => {
      const {ctx, platform} = buildCtx({domainList: vi.fn().mockResolvedValue(appDomains)})

      await createAndAssociate(ctx, 'my-app', certificate, {resolveDomains: async candidates => candidates})

      expect(platform.domain.update).toHaveBeenCalledTimes(2)
      expect(platform.domain.update).toHaveBeenCalledWith('my-app', 'www.example.com', {sni_endpoint: 'tokyo-1234'})
      expect(platform.domain.update).toHaveBeenCalledWith('my-app', 'v1.api.example.com', {sni_endpoint: 'tokyo-1234'})
    })

    it('makes no association calls when resolveDomains returns an empty selection', async () => {
      const {ctx, platform} = buildCtx({domainList: vi.fn().mockResolvedValue(appDomains)})
      const resolveDomains = vi.fn().mockResolvedValue([])

      await createAndAssociate(ctx, 'my-app', certificate, {resolveDomains})

      expect(resolveDomains).toHaveBeenCalledOnce()
      expect(platform.domain.update).not.toHaveBeenCalled()
    })

    it('creates the endpoint, then resolves, then associates', async () => {
      const calls: string[] = []
      const {ctx} = buildCtx({
        domainList: vi.fn().mockResolvedValue(appDomains),
        domainUpdate: vi.fn(async () => {
          calls.push('update')
          return {}
        }),
        sniEndpointCreate: vi.fn(async () => {
          calls.push('create')
          return buildSniEndpoint()
        }),
      })

      await createAndAssociate(ctx, 'my-app', certificate, {
        async resolveDomains(candidates) {
          calls.push('resolve')
          return candidates.slice(0, 1)
        },
      })

      expect(calls).toEqual(['create', 'resolve', 'update'])
    })

    it('waits for the app\'s pending domains, with domainPoller, before listing them for matching', async () => {
      const calls: string[] = []
      const pending = buildDomain({hostname: 'www.example.com', id: 'd1', status: 'pending'})
      const {ctx, platform} = buildCtx({
        domainInfo: vi.fn(async () => {
          calls.push('info')
          return {...pending, status: 'succeeded'}
        }),
        domainList: vi.fn().mockResolvedValue([pending]),
      })

      await createAndAssociate(ctx, 'my-app', certificate, {
        domainPoller: {onStart: () => calls.push('start'), onStop: () => calls.push('stop')},
        intervalMs: 1,
        async resolveDomains(candidates) {
          calls.push('resolve')
          return candidates
        },
      })

      expect(calls).toEqual(['start', 'info', 'stop', 'resolve'])
      expect(platform.domain.update).toHaveBeenCalledExactlyOnceWith('my-app', 'www.example.com', {sni_endpoint: 'tokyo-1234'})
    })

    it('wraps a resolveDomains rejection in SniEndpointAssociationError and makes no association calls', async () => {
      const sniEndpoint = buildSniEndpoint({id: 'e1', name: 'tokyo-1234'})
      const {ctx, platform} = buildCtx({domainList: vi.fn().mockResolvedValue(appDomains), sniEndpointCreate: vi.fn().mockResolvedValue(sniEndpoint)})
      const cancelled = new Error('User cancelled')

      const error = await createAndAssociate(ctx, 'my-app', certificate, {resolveDomains: vi.fn().mockRejectedValue(cancelled)}).catch(error_ => error_)

      expect(error).toBeInstanceOf(SniEndpointAssociationError)
      expect(error.message).toBe('The certificate was uploaded to my-app as tokyo-1234, but associating it with domains failed: User cancelled')
      expect(error.sniEndpoint).toBe(sniEndpoint)
      expect(error.cause).toBe(cancelled)
      expect(error.statusCode).toBeUndefined()
      expect(error.body).toEqual({id: 'association_failed', message: error.message, sni_endpoint: {id: 'e1', name: 'tokyo-1234'}})
      expect(platform.domain.update).not.toHaveBeenCalled()
    })

    it('rethrows an abort from resolveDomains as is, not wrapped', async () => {
      const controller = new AbortController()
      const {ctx} = buildCtx({domainList: vi.fn().mockResolvedValue(appDomains)})

      const error = await createAndAssociate(ctx, 'my-app', certificate, {
        async resolveDomains() {
          controller.abort()
          throw controller.signal.reason
        },
        signal: controller.signal,
      }).catch(error_ => error_)

      expect(error).not.toBeInstanceOf(SniEndpointAssociationError)
      expect(error.name).toBe('AbortError')
    })

    it('stops waiting and makes no association calls when aborted during the domain wait', async () => {
      const controller = new AbortController()
      const pending = buildDomain({hostname: 'www.example.com', status: 'pending'})
      const resolveDomains = vi.fn()
      const {ctx, platform} = buildCtx({
        domainList: vi.fn(async () => {
          controller.abort()
          return [pending]
        }),
      })

      const error = await createAndAssociate(ctx, 'my-app', certificate, {intervalMs: 1000, resolveDomains, signal: controller.signal}).catch(error_ => error_)

      expect(error.name).toBe('AbortError')
      expect(platform.sniEndpoint.create).toHaveBeenCalledOnce()
      expect(platform.domain.info).not.toHaveBeenCalled()
      expect(resolveDomains).not.toHaveBeenCalled()
      expect(platform.domain.update).not.toHaveBeenCalled()
    })
  })

  describe('with domains', () => {
    it('associates exactly the requested hostnames and returns the re-fetched endpoint', async () => {
      const sniEndpoint = buildSniEndpoint({domains: [], name: 'tokyo-1234'})
      const associated = {...sniEndpoint, domains: ['d1', 'd2']}
      const {ctx, platform} = buildCtx({
        domainList: vi.fn().mockResolvedValue(appDomains),
        sniEndpointCreate: vi.fn().mockResolvedValue(sniEndpoint),
        sniEndpointInfo: vi.fn().mockResolvedValue(associated),
      })

      const result = await createAndAssociate(ctx, 'my-app', certificate, {domains: ['www.example.com', 'v1.api.example.com']})

      expect(platform.domain.update).toHaveBeenCalledTimes(2)
      expect(platform.domain.update).toHaveBeenCalledWith('my-app', 'www.example.com', {sni_endpoint: 'tokyo-1234'})
      expect(platform.domain.update).toHaveBeenCalledWith('my-app', 'v1.api.example.com', {sni_endpoint: 'tokyo-1234'})
      expect(platform.sniEndpoint.info).toHaveBeenCalledExactlyOnceWith('my-app', sniEndpoint.id)
      expect(result).toEqual(associated)
    })

    it('matches requested hostnames case-insensitively and associates the app\'s hostname once', async () => {
      const {ctx, platform} = buildCtx({domainList: vi.fn().mockResolvedValue(appDomains)})

      await createAndAssociate(ctx, 'my-app', certificate, {domains: ['WWW.Example.com', 'www.example.com']})

      expect(platform.domain.update).toHaveBeenCalledExactlyOnceWith('my-app', 'www.example.com', {sni_endpoint: 'tokyo-1234'})
    })

    it('associates none, without listing, waiting, or re-fetching, for domains: []', async () => {
      const sniEndpoint = buildSniEndpoint()
      const domainPoller = {onStart: vi.fn(), onStop: vi.fn()}
      const {ctx, platform} = buildCtx({sniEndpointCreate: vi.fn().mockResolvedValue(sniEndpoint)})

      const result = await createAndAssociate(ctx, 'my-app', certificate, {domainPoller, domains: []})

      expect(platform.domain.list).not.toHaveBeenCalled()
      expect(platform.domain.info).not.toHaveBeenCalled()
      expect(domainPoller.onStart).not.toHaveBeenCalled()
      expect(platform.domain.update).not.toHaveBeenCalled()
      expect(platform.sniEndpoint.info).not.toHaveBeenCalled()
      expect(result).toBe(sniEndpoint)
    })

    it('waits only on the requested domains, not other pending domains on the app', async () => {
      const calls: string[] = []
      const requested = buildDomain({hostname: 'www.example.com', id: 'd1', status: 'pending'})
      const stuck = buildDomain({hostname: 'stuck.example.org', id: 'd9', status: 'pending'})
      const domainInfo = vi.fn(async () => {
        calls.push('info')
        return {...requested, status: 'succeeded'}
      })
      const {ctx, platform} = buildCtx({domainInfo, domainList: vi.fn().mockResolvedValue([requested, stuck])})

      await createAndAssociate(ctx, 'my-app', certificate, {
        domainPoller: {onStart: () => calls.push('start'), onStop: () => calls.push('stop')},
        domains: ['www.example.com'],
        intervalMs: 1,
      })

      expect(domainInfo).toHaveBeenCalledExactlyOnceWith('my-app', 'd1')
      expect(calls).toEqual(['start', 'info', 'stop'])
      expect(platform.domain.list).toHaveBeenCalledOnce()
      expect(platform.domain.update).toHaveBeenCalledExactlyOnceWith('my-app', 'www.example.com', {sni_endpoint: 'tokyo-1234'})
    })

    it('throws CertificateDomainsMismatchError before uploading when a hostname is not on the app or not covered', async () => {
      const {ctx, platform} = buildCtx({domainList: vi.fn().mockResolvedValue(appDomains)})

      const error = await createAndAssociate(ctx, 'my-app', certificate, {
        domains: ['www.example.com', 'typo.example.com', 'shop.example.org'],
      }).catch((error_: unknown) => error_)

      expect(error).toBeInstanceOf(CertificateDomainsMismatchError)
      expect(error).toMatchObject({
        id: 'domains_mismatch',
        message: 'Can\'t associate the certificate: typo.example.com isn\'t a domain on my-app; shop.example.org isn\'t covered by the certificate. Nothing was uploaded.',
        notCovered: ['shop.example.org'],
        notOnApp: ['typo.example.com'],
        statusCode: 422,
      })
      expect(platform.sniEndpoint.create).not.toHaveBeenCalled()
    })

    it('names the uploaded endpoint, with the API error\'s status, when an association call fails', async () => {
      const locked = Object.assign(new Error('Domain is locked.'), {statusCode: 422})
      const {ctx} = buildCtx({domainList: vi.fn().mockResolvedValue(appDomains), domainUpdate: vi.fn().mockRejectedValue(locked)})

      const error = await createAndAssociate(ctx, 'my-app', certificate, {domains: ['www.example.com']}).catch(error_ => error_)

      expect(error).toBeInstanceOf(SniEndpointAssociationError)
      expect(error.message).toBe('The certificate was uploaded to my-app as tokyo-1234, but associating it with domains failed: Domain is locked.')
      expect(error.statusCode).toBe(422)
      expect(error.cause).toBe(locked)
    })

    it('throws a re-fetch failure as is, since the associations were made', async () => {
      const unavailable = Object.assign(new Error('Service unavailable.'), {statusCode: 503})
      const {ctx, platform} = buildCtx({domainList: vi.fn().mockResolvedValue(appDomains), sniEndpointInfo: vi.fn().mockRejectedValue(unavailable)})

      await expect(createAndAssociate(ctx, 'my-app', certificate, {domains: ['www.example.com']})).rejects.toBe(unavailable)
      expect(platform.domain.update).toHaveBeenCalledOnce()
    })
  })

  describe('with neither domains nor resolveDomains', () => {
    it('uploads without associating when the certificate covers none of the app\'s domains', async () => {
      const sniEndpoint = buildSniEndpoint()
      const {ctx, platform} = buildCtx({
        domainList: vi.fn().mockResolvedValue([buildDomain({hostname: 'shop.example.org', status: 'pending'})]),
        sniEndpointCreate: vi.fn().mockResolvedValue(sniEndpoint),
      })

      await expect(createAndAssociate(ctx, 'my-app', certificate)).resolves.toBe(sniEndpoint)
      expect(platform.domain.list).toHaveBeenCalledOnce()
      expect(platform.domain.info).not.toHaveBeenCalled()
      expect(platform.domain.update).not.toHaveBeenCalled()
    })

    it('throws CertificateDomainsRequiredError before uploading when the certificate covers app domains', async () => {
      const {ctx, platform} = buildCtx({domainList: vi.fn().mockResolvedValue(appDomains)})

      const error = await createAndAssociate(ctx, 'my-app', certificate, {}).catch(error_ => error_)

      expect(error).toBeInstanceOf(CertificateDomainsRequiredError)
      expect(error).toMatchObject({
        id: 'domains_required',
        matches: ['www.example.com', 'v1.api.example.com'],
        message: 'The certificate covers www.example.com, v1.api.example.com on my-app. Pass the hostnames to associate, or none. Nothing was uploaded.',
        statusCode: 422,
      })
      expect(platform.sniEndpoint.create).not.toHaveBeenCalled()
    })
  })

  describe('before upload', () => {
    it('throws CertificateParseError for an unreadable certificate, before any request', async () => {
      const {ctx, platform} = buildCtx({domainList: vi.fn().mockResolvedValue(appDomains)})

      await expect(createAndAssociate(ctx, 'my-app', {certificateChain: 'CERT_CHAIN', privateKey: 'PRIVATE_KEY'}, {domains: []}))
        .rejects.toBeInstanceOf(CertificateParseError)
      expect(platform.domain.list).not.toHaveBeenCalled()
      expect(platform.sniEndpoint.create).not.toHaveBeenCalled()
    })

    it('rejects domains with resolveDomains, before any request', async () => {
      const {ctx, platform} = buildCtx()
      const options = {domains: [], resolveDomains: vi.fn()} as never

      await expect(createAndAssociate(ctx, 'my-app', certificate, options)).rejects.toThrow(new TypeError('Pass domains or resolveDomains, not both.'))
      expect(platform.domain.list).not.toHaveBeenCalled()
      expect(platform.sniEndpoint.create).not.toHaveBeenCalled()
    })

    it('throws if the signal is already aborted, before any request', async () => {
      const {ctx, platform} = buildCtx()
      const controller = new AbortController()
      controller.abort()

      const error = await createAndAssociate(ctx, 'my-app', certificate, {domains: [], signal: controller.signal}).catch(error_ => error_)

      expect(error.name).toBe('AbortError')
      expect(platform.sniEndpoint.create).not.toHaveBeenCalled()
    })

    it('threads the signal through withOptions', async () => {
      const {ctx, platform} = buildCtx()
      const controller = new AbortController()

      await createAndAssociate(ctx, 'my-app', certificate, {domains: [], signal: controller.signal})

      expect(platform.withOptions).toHaveBeenCalledWith({signal: controller.signal})
    })
  })
})
