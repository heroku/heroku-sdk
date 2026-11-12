/* eslint-disable camelcase */
import {
  describe, expect, it, vi,
} from 'vitest'

import type {ResourceCtx} from '../../../core/extend-resource.js'

import {buildDomain, buildSniEndpoint} from '../domain/test-utils.js'
import {
  deleteByApp, infoByApp, SniEndpointAmbiguousError, SniEndpointNotFoundError, updateByApp,
} from './by-app.js'

/** A `domain.info` stub that returns `<id>.example.com` for each domain id. */
const domainInfo = () => vi.fn(async (_app: string, id: string) => buildDomain({hostname: `${id}.example.com`, id}))

const notFound = () => Object.assign(new Error('Not found.'), {statusCode: 404})

function buildCtx(stubs: Partial<Record<'domainInfo' | 'sniDelete' | 'sniInfo' | 'sniList' | 'sniUpdate', ReturnType<typeof vi.fn>>> = {}) {
  const platform = {
    domain: {info: stubs.domainInfo ?? vi.fn()},
    sniEndpoint: {
      delete: stubs.sniDelete ?? vi.fn(),
      info: stubs.sniInfo ?? vi.fn(),
      list: stubs.sniList ?? vi.fn().mockResolvedValue([]),
      update: stubs.sniUpdate ?? vi.fn(),
    },
    withOptions: vi.fn(),
  }
  platform.withOptions.mockReturnValue(platform)
  return {ctx: {data: {} as never, platform: platform as never} as ResourceCtx, platform}
}

describe('infoByApp', () => {
  const tokyo = buildSniEndpoint({id: 'e1', name: 'tokyo-1234'})
  const akita = buildSniEndpoint({id: 'e2', name: 'akita-5678'})

  it('returns the app\'s only endpoint when nothing is selected', async () => {
    const {ctx} = buildCtx({sniList: vi.fn().mockResolvedValue([tokyo])})

    await expect(infoByApp(ctx, 'my-app')).resolves.toBe(tokyo)
  })

  it('throws SniEndpointNotFoundError when the app has no endpoints', async () => {
    const {ctx} = buildCtx()

    const error = await infoByApp(ctx, 'my-app').catch(error_ => error_)
    expect(error).toBeInstanceOf(SniEndpointNotFoundError)
    expect(error.message).toBe('my-app has no SSL certificates.')
  })

  it('throws SniEndpointAmbiguousError naming the endpoints when the app has several', async () => {
    const {ctx} = buildCtx({sniList: vi.fn().mockResolvedValue([tokyo, akita])})

    const error = await infoByApp(ctx, 'my-app').catch(error_ => error_)
    expect(error).toBeInstanceOf(SniEndpointAmbiguousError)
    expect(error.message).toBe('my-app has 2 SSL certificates (tokyo-1234, akita-5678); select one by name.')
    expect(error.matches).toEqual([tokyo, akita])
    expect(error.body).toEqual({
      id: 'multiple_matches', matches: [{id: 'e1', name: 'tokyo-1234'}, {id: 'e2', name: 'akita-5678'}], message: error.message,
    })
  })

  it('fetches an endpoint by name', async () => {
    const info = vi.fn().mockResolvedValue(tokyo)
    const {ctx, platform} = buildCtx({sniInfo: info})

    await expect(infoByApp(ctx, 'my-app', {name: 'tokyo-1234'})).resolves.toBe(tokyo)
    expect(info).toHaveBeenCalledExactlyOnceWith('my-app', 'tokyo-1234')
    expect(platform.sniEndpoint.list).not.toHaveBeenCalled()
  })

  it('throws SniEndpointNotFoundError for an unknown name', async () => {
    const {ctx} = buildCtx({sniInfo: vi.fn().mockRejectedValue(notFound())})

    await expect(infoByApp(ctx, 'my-app', {name: 'nope'}))
      .rejects.toThrow(new SniEndpointNotFoundError('my-app', {name: 'nope'}, 'Couldn\'t find an SSL certificate named nope on my-app.'))
  })

  it('rethrows a 404 for the app itself unchanged', async () => {
    const appNotFound = Object.assign(new Error('Couldn\'t find that app.'), {resource: 'app', statusCode: 404})
    const {ctx} = buildCtx({sniInfo: vi.fn().mockRejectedValue(appNotFound)})

    await expect(infoByApp(ctx, 'my-app', {name: 'tokyo-1234'})).rejects.toBe(appNotFound)
  })

  it('rethrows errors other than 404 unchanged', async () => {
    const forbidden = Object.assign(new Error('Forbidden.'), {statusCode: 403})
    const {ctx} = buildCtx({sniInfo: vi.fn().mockRejectedValue(forbidden)})

    await expect(infoByApp(ctx, 'my-app', {name: 'tokyo-1234'})).rejects.toBe(forbidden)
  })

  it('fetches the endpoint a hostname is associated with', async () => {
    const domainInfo = vi.fn().mockResolvedValue(buildDomain({hostname: 'www.example.com', sni_endpoint: {id: 'e1', name: 'tokyo-1234'}}))
    const info = vi.fn().mockResolvedValue(tokyo)
    const {ctx} = buildCtx({domainInfo, sniInfo: info})

    await expect(infoByApp(ctx, 'my-app', {hostname: 'www.example.com'})).resolves.toBe(tokyo)
    expect(domainInfo).toHaveBeenCalledExactlyOnceWith('my-app', 'www.example.com')
    expect(info).toHaveBeenCalledExactlyOnceWith('my-app', 'e1')
  })

  it('throws SniEndpointNotFoundError for a hostname that isn\'t on the app', async () => {
    const {ctx} = buildCtx({domainInfo: vi.fn().mockRejectedValue(notFound())})

    await expect(infoByApp(ctx, 'my-app', {hostname: 'other.example.com'}))
      .rejects.toThrow('other.example.com isn\'t a domain on my-app.')
  })

  it('throws SniEndpointNotFoundError when the hostname\'s endpoint is gone', async () => {
    const domainInfo = vi.fn().mockResolvedValue(buildDomain({hostname: 'www.example.com', sni_endpoint: {id: 'e1', name: 'tokyo-1234'}}))
    const {ctx} = buildCtx({domainInfo, sniInfo: vi.fn().mockRejectedValue(notFound())})

    const error = await infoByApp(ctx, 'my-app', {hostname: 'www.example.com'}).catch(error_ => error_)
    expect(error).toBeInstanceOf(SniEndpointNotFoundError)
    expect(error.message).toBe('Couldn\'t find the SSL certificate associated with www.example.com on my-app.')
  })

  it('rethrows a 404 for the app itself unchanged on the hostname path', async () => {
    const appNotFound = Object.assign(new Error('Couldn\'t find that app.'), {resource: 'app', statusCode: 404})
    const {ctx} = buildCtx({domainInfo: vi.fn().mockRejectedValue(appNotFound)})

    await expect(infoByApp(ctx, 'my-app', {hostname: 'www.example.com'})).rejects.toBe(appNotFound)
  })

  it('throws SniEndpointNotFoundError for a hostname without an endpoint', async () => {
    const {ctx} = buildCtx({domainInfo: vi.fn().mockResolvedValue(buildDomain({hostname: 'www.example.com', sni_endpoint: null}))})

    const error = await infoByApp(ctx, 'my-app', {hostname: 'www.example.com'}).catch(error_ => error_)
    expect(error).toBeInstanceOf(SniEndpointNotFoundError)
    expect(error.message).toBe('www.example.com on my-app isn\'t associated with an SSL certificate.')
  })

  it('rejects a name and a hostname together, before any request', async () => {
    const {ctx, platform} = buildCtx()

    await expect(infoByApp(ctx, 'my-app', {hostname: 'www.example.com', name: 'tokyo-1234'} as never)).rejects.toThrow(TypeError)
    expect(platform.sniEndpoint.list).not.toHaveBeenCalled()
  })

  it.each([
    [{name: ''}, 'An SSL certificate name can\'t be empty.'],
    [{hostname: ''}, 'An SSL certificate hostname can\'t be empty.'],
  ])('rejects an empty selector value %o, before any request', async (selector, message) => {
    const {ctx, platform} = buildCtx({sniList: vi.fn().mockResolvedValue([tokyo])})

    await expect(infoByApp(ctx, 'my-app', selector)).rejects.toThrow(new TypeError(message))
    expect(platform.sniEndpoint.list).not.toHaveBeenCalled()
    expect(platform.sniEndpoint.info).not.toHaveBeenCalled()
    expect(platform.domain.info).not.toHaveBeenCalled()
  })

  it('stops before any request when the signal is already aborted', async () => {
    const {ctx, platform} = buildCtx({sniList: vi.fn().mockResolvedValue([tokyo])})
    const controller = new AbortController()
    controller.abort()

    await expect(infoByApp(ctx, 'my-app', {}, {signal: controller.signal})).rejects.toMatchObject({name: 'AbortError'})
    expect(platform.sniEndpoint.list).not.toHaveBeenCalled()
  })

  it('threads the signal through withOptions', async () => {
    const {ctx, platform} = buildCtx({sniList: vi.fn().mockResolvedValue([tokyo])})
    const controller = new AbortController()

    await infoByApp(ctx, 'my-app', {}, {signal: controller.signal})

    expect(platform.withOptions).toHaveBeenCalledWith({signal: controller.signal})
  })

  describe('includeDomainHostnames', () => {
    const withDomains = buildSniEndpoint({domains: ['d1', 'd2'], id: 'e1', name: 'tokyo-1234'})

    it('adds each associated domain\'s hostname, in domains order', async () => {
      const {ctx, platform} = buildCtx({domainInfo: domainInfo(), sniList: vi.fn().mockResolvedValue([withDomains])})

      await expect(infoByApp(ctx, 'my-app', {}, {includeDomainHostnames: true})).resolves.toEqual({
        ...withDomains, domain_hostnames: ['d1.example.com', 'd2.example.com'],
      })
      expect(platform.domain.info.mock.calls).toEqual([['my-app', 'd1'], ['my-app', 'd2']])
    })

    it('returns an empty list for an endpoint with no domains', async () => {
      const noDomains = buildSniEndpoint({domains: [], id: 'e1', name: 'tokyo-1234'})
      const {ctx, platform} = buildCtx({domainInfo: domainInfo(), sniList: vi.fn().mockResolvedValue([noDomains])})

      await expect(infoByApp(ctx, 'my-app', {}, {includeDomainHostnames: true})).resolves.toMatchObject({domain_hostnames: []})
      expect(platform.domain.info).not.toHaveBeenCalled()
    })

    it('fetches no domains without the option', async () => {
      const {ctx, platform} = buildCtx({domainInfo: domainInfo(), sniList: vi.fn().mockResolvedValue([withDomains])})

      const sniEndpoint = await infoByApp(ctx, 'my-app')
      expect(sniEndpoint).toBe(withDomains)
      expect(sniEndpoint).not.toHaveProperty('domain_hostnames')
      expect(platform.domain.info).not.toHaveBeenCalled()
    })

    it('rethrows a failed domain lookup as is', async () => {
      const failure = Object.assign(new Error('Not found.'), {statusCode: 404})
      const {ctx} = buildCtx({domainInfo: vi.fn().mockRejectedValue(failure), sniList: vi.fn().mockResolvedValue([withDomains])})

      await expect(infoByApp(ctx, 'my-app', {}, {includeDomainHostnames: true})).rejects.toBe(failure)
    })
  })
})

describe('deleteByApp', () => {
  const tokyo = buildSniEndpoint({id: 'e1', name: 'tokyo-1234'})

  it('calls beforeDelete with the selected endpoint, then deletes it', async () => {
    const calls: string[] = []
    const beforeDelete = vi.fn(() => {
      calls.push('beforeDelete')
    })
    const sniDelete = vi.fn(async () => {
      calls.push('delete')
      return tokyo
    })
    const {ctx} = buildCtx({sniDelete, sniList: vi.fn().mockResolvedValue([tokyo])})

    await expect(deleteByApp(ctx, 'my-app', {}, {beforeDelete})).resolves.toBe(tokyo)
    expect(beforeDelete).toHaveBeenCalledExactlyOnceWith({sniEndpoint: tokyo})
    expect(sniDelete).toHaveBeenCalledExactlyOnceWith('my-app', 'e1')
    expect(calls).toEqual(['beforeDelete', 'delete'])
  })

  it('doesn\'t delete when beforeDelete throws', async () => {
    const sniDelete = vi.fn()
    const {ctx} = buildCtx({sniDelete, sniList: vi.fn().mockResolvedValue([tokyo])})

    await expect(deleteByApp(ctx, 'my-app', {}, {beforeDelete: () => Promise.reject(new Error('Not confirmed'))})).rejects.toThrow('Not confirmed')
    expect(sniDelete).not.toHaveBeenCalled()
  })

  it('doesn\'t delete when the signal is aborted during beforeDelete', async () => {
    const controller = new AbortController()
    const sniDelete = vi.fn()
    const {ctx} = buildCtx({sniDelete, sniList: vi.fn().mockResolvedValue([tokyo])})

    const error = await deleteByApp(ctx, 'my-app', {}, {beforeDelete: () => controller.abort(), signal: controller.signal}).catch(error_ => error_)
    expect(error.name).toBe('AbortError')
    expect(sniDelete).not.toHaveBeenCalled()
  })
})

describe('updateByApp', () => {
  const tokyo = buildSniEndpoint({id: 'e1', name: 'tokyo-1234'})
  const certificate = {certificateChain: 'CERT_CHAIN', privateKey: 'PRIVATE_KEY'}

  it('calls beforeUpdate with the selected endpoint, then updates it', async () => {
    const beforeUpdate = vi.fn()
    const sniUpdate = vi.fn().mockResolvedValue(tokyo)
    const {ctx} = buildCtx({sniInfo: vi.fn().mockResolvedValue(tokyo), sniUpdate})

    await expect(updateByApp(ctx, 'my-app', {name: 'tokyo-1234'}, certificate, {beforeUpdate})).resolves.toBe(tokyo)
    expect(beforeUpdate).toHaveBeenCalledExactlyOnceWith({sniEndpoint: tokyo})
    expect(sniUpdate).toHaveBeenCalledExactlyOnceWith('my-app', 'e1', {certificate_chain: 'CERT_CHAIN', private_key: 'PRIVATE_KEY'})
  })

  it('doesn\'t update when beforeUpdate throws', async () => {
    const sniUpdate = vi.fn()
    const {ctx} = buildCtx({sniInfo: vi.fn().mockResolvedValue(tokyo), sniUpdate})

    await expect(updateByApp(ctx, 'my-app', {name: 'tokyo-1234'}, certificate, {
      beforeUpdate() {
        throw new Error('Not confirmed')
      },
    })).rejects.toThrow('Not confirmed')
    expect(sniUpdate).not.toHaveBeenCalled()
  })

  it('doesn\'t update when the signal is aborted during beforeUpdate', async () => {
    const controller = new AbortController()
    const sniUpdate = vi.fn()
    const {ctx} = buildCtx({sniInfo: vi.fn().mockResolvedValue(tokyo), sniUpdate})

    const error = await updateByApp(ctx, 'my-app', {name: 'tokyo-1234'}, certificate, {
      beforeUpdate: () => controller.abort(),
      signal: controller.signal,
    }).catch(error_ => error_)
    expect(error.name).toBe('AbortError')
    expect(sniUpdate).not.toHaveBeenCalled()
  })
})
