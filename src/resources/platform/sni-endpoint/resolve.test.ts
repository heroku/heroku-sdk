/* eslint-disable camelcase */
import {
  describe, expect, it, vi,
} from 'vitest'

import type {ResourceCtx} from '../../../core/extend-resource.js'

import {buildDomain, buildSniEndpoint} from '../domain/test-utils.js'
import {
  resolveAndDelete, resolveAndUpdate, resolveSniEndpoint, SniEndpointAmbiguousError, SniEndpointNotFoundError,
} from './resolve.js'

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

describe('resolveSniEndpoint', () => {
  const tokyo = buildSniEndpoint({id: 'e1', name: 'tokyo-1234'})
  const akita = buildSniEndpoint({id: 'e2', name: 'akita-5678'})

  it('returns the app\'s only endpoint when nothing is selected', async () => {
    const {ctx} = buildCtx({sniList: vi.fn().mockResolvedValue([tokyo])})

    await expect(resolveSniEndpoint(ctx, 'my-app')).resolves.toBe(tokyo)
  })

  it('throws SniEndpointNotFoundError when the app has no endpoints', async () => {
    const {ctx} = buildCtx()

    const error = await resolveSniEndpoint(ctx, 'my-app').catch(error_ => error_)
    expect(error).toBeInstanceOf(SniEndpointNotFoundError)
    expect(error.message).toBe('my-app has no SSL certificates.')
  })

  it('throws SniEndpointAmbiguousError naming the endpoints when the app has several', async () => {
    const {ctx} = buildCtx({sniList: vi.fn().mockResolvedValue([tokyo, akita])})

    const error = await resolveSniEndpoint(ctx, 'my-app').catch(error_ => error_)
    expect(error).toBeInstanceOf(SniEndpointAmbiguousError)
    expect(error.message).toBe('my-app has 2 SSL certificates (tokyo-1234, akita-5678); select one by name.')
    expect(error.matches).toEqual([tokyo, akita])
  })

  it('fetches an endpoint by name', async () => {
    const info = vi.fn().mockResolvedValue(tokyo)
    const {ctx, platform} = buildCtx({sniInfo: info})

    await expect(resolveSniEndpoint(ctx, 'my-app', {name: 'tokyo-1234'})).resolves.toBe(tokyo)
    expect(info).toHaveBeenCalledExactlyOnceWith('my-app', 'tokyo-1234')
    expect(platform.sniEndpoint.list).not.toHaveBeenCalled()
  })

  it('throws SniEndpointNotFoundError for an unknown name', async () => {
    const {ctx} = buildCtx({sniInfo: vi.fn().mockRejectedValue(notFound())})

    await expect(resolveSniEndpoint(ctx, 'my-app', {name: 'nope'}))
      .rejects.toThrow(new SniEndpointNotFoundError('my-app', {name: 'nope'}, 'Couldn\'t find an SSL certificate named nope on my-app.'))
  })

  it('rethrows errors other than 404 unchanged', async () => {
    const forbidden = Object.assign(new Error('Forbidden.'), {statusCode: 403})
    const {ctx} = buildCtx({sniInfo: vi.fn().mockRejectedValue(forbidden)})

    await expect(resolveSniEndpoint(ctx, 'my-app', {name: 'tokyo-1234'})).rejects.toBe(forbidden)
  })

  it('fetches the endpoint a hostname is associated with', async () => {
    const domainInfo = vi.fn().mockResolvedValue(buildDomain({hostname: 'www.example.com', sni_endpoint: {id: 'e1', name: 'tokyo-1234'}}))
    const info = vi.fn().mockResolvedValue(tokyo)
    const {ctx} = buildCtx({domainInfo, sniInfo: info})

    await expect(resolveSniEndpoint(ctx, 'my-app', {hostname: 'www.example.com'})).resolves.toBe(tokyo)
    expect(domainInfo).toHaveBeenCalledExactlyOnceWith('my-app', 'www.example.com')
    expect(info).toHaveBeenCalledExactlyOnceWith('my-app', 'e1')
  })

  it('throws SniEndpointNotFoundError for a hostname that isn\'t on the app', async () => {
    const {ctx} = buildCtx({domainInfo: vi.fn().mockRejectedValue(notFound())})

    await expect(resolveSniEndpoint(ctx, 'my-app', {hostname: 'other.example.com'}))
      .rejects.toThrow('other.example.com isn\'t a domain on my-app.')
  })

  it('throws SniEndpointNotFoundError for a hostname without an endpoint', async () => {
    const {ctx} = buildCtx({domainInfo: vi.fn().mockResolvedValue(buildDomain({hostname: 'www.example.com', sni_endpoint: null}))})

    const error = await resolveSniEndpoint(ctx, 'my-app', {hostname: 'www.example.com'}).catch(error_ => error_)
    expect(error).toBeInstanceOf(SniEndpointNotFoundError)
    expect(error.message).toBe('www.example.com on my-app isn\'t associated with an SSL certificate.')
  })

  it('rejects a name and a hostname together, before any request', async () => {
    const {ctx, platform} = buildCtx()

    await expect(resolveSniEndpoint(ctx, 'my-app', {hostname: 'www.example.com', name: 'tokyo-1234'})).rejects.toThrow(TypeError)
    expect(platform.sniEndpoint.list).not.toHaveBeenCalled()
  })

  it('threads the signal through withOptions', async () => {
    const {ctx, platform} = buildCtx({sniList: vi.fn().mockResolvedValue([tokyo])})
    const controller = new AbortController()

    await resolveSniEndpoint(ctx, 'my-app', {}, {signal: controller.signal})

    expect(platform.withOptions).toHaveBeenCalledWith({signal: controller.signal})
  })
})

describe('resolveAndDelete', () => {
  const tokyo = buildSniEndpoint({id: 'e1', name: 'tokyo-1234'})

  it('calls beforeDelete with the resolved endpoint, then deletes it', async () => {
    const calls: string[] = []
    const beforeDelete = vi.fn(() => {
      calls.push('beforeDelete')
    })
    const sniDelete = vi.fn(async () => {
      calls.push('delete')
      return tokyo
    })
    const {ctx} = buildCtx({sniDelete, sniList: vi.fn().mockResolvedValue([tokyo])})

    await expect(resolveAndDelete(ctx, 'my-app', {}, {beforeDelete})).resolves.toBe(tokyo)
    expect(beforeDelete).toHaveBeenCalledExactlyOnceWith(tokyo)
    expect(sniDelete).toHaveBeenCalledExactlyOnceWith('my-app', 'e1')
    expect(calls).toEqual(['beforeDelete', 'delete'])
  })

  it('doesn\'t delete when beforeDelete throws', async () => {
    const sniDelete = vi.fn()
    const {ctx} = buildCtx({sniDelete, sniList: vi.fn().mockResolvedValue([tokyo])})

    await expect(resolveAndDelete(ctx, 'my-app', {}, {beforeDelete: () => Promise.reject(new Error('Not confirmed'))})).rejects.toThrow('Not confirmed')
    expect(sniDelete).not.toHaveBeenCalled()
  })
})

describe('resolveAndUpdate', () => {
  const tokyo = buildSniEndpoint({id: 'e1', name: 'tokyo-1234'})
  const certificate = {certificate_chain: 'CERT_CHAIN', private_key: 'PRIVATE_KEY'}

  it('calls beforeUpdate with the resolved endpoint, then updates it', async () => {
    const beforeUpdate = vi.fn()
    const sniUpdate = vi.fn().mockResolvedValue(tokyo)
    const {ctx} = buildCtx({sniInfo: vi.fn().mockResolvedValue(tokyo), sniUpdate})

    await expect(resolveAndUpdate(ctx, 'my-app', {name: 'tokyo-1234'}, certificate, {beforeUpdate})).resolves.toBe(tokyo)
    expect(beforeUpdate).toHaveBeenCalledExactlyOnceWith(tokyo)
    expect(sniUpdate).toHaveBeenCalledExactlyOnceWith('my-app', 'e1', certificate)
  })

  it('doesn\'t update when beforeUpdate throws', async () => {
    const sniUpdate = vi.fn()
    const {ctx} = buildCtx({sniInfo: vi.fn().mockResolvedValue(tokyo), sniUpdate})

    await expect(resolveAndUpdate(ctx, 'my-app', {name: 'tokyo-1234'}, certificate, {
      beforeUpdate() {
        throw new Error('Not confirmed')
      },
    })).rejects.toThrow('Not confirmed')
    expect(sniUpdate).not.toHaveBeenCalled()
  })
})
