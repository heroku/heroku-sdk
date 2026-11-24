import type {PipelineCoupling} from '@heroku/types/3.sdk'

import {
  afterEach, describe, expect, expectTypeOf, it, vi,
} from 'vitest'

import type {ResourceCtx} from '../../../core/extend-resource.js'

import {HerokuSDK} from '../../../core/heroku-sdk.js'
import {pipelineCouplingExtensions} from '../pipeline/coupling.js'
import {CouplingNotFoundError, removeByApp} from './remove-by-app.js'

function ctxWith(infoByApp = vi.fn(), deleteCoupling = vi.fn()) {
  const platform = {
    pipelineCoupling: {delete: deleteCoupling, infoByApp},
    withOptions: vi.fn(),
  }
  platform.withOptions.mockReturnValue(platform)
  return {
    ctx: {platform} as unknown as ResourceCtx, deleteCoupling, infoByApp, platform,
  }
}

describe('removeByApp', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('sends the registered lookup and DELETE with the documented Platform API Accept header', async () => {
    const lookup = {id: 'coupling-1', stage: 'staging'}
    const deleted = {id: 'coupling-1', stage: 'production'}
    const requests: Request[] = []
    const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
      const request = input instanceof Request ? input : new Request(input, init)
      requests.push(request)

      if (request.method === 'GET' && request.url === 'https://api.heroku.com/apps/example-app/pipeline-couplings') {
        return new Response(JSON.stringify(lookup), {headers: {'content-type': 'application/json'}})
      }

      if (request.method === 'DELETE' && request.url === 'https://api.heroku.com/pipeline-couplings/coupling-1') {
        return new Response(JSON.stringify(deleted), {headers: {'content-type': 'application/json'}})
      }

      throw new Error(`Unexpected network request: ${request.method} ${request.url}`)
    })
    vi.stubGlobal('fetch', fetch)

    const sdk = new HerokuSDK({
      clientOptions: {token: 'test-token'},
      extensions: [pipelineCouplingExtensions],
    })

    await expect(sdk.platform.pipelineCoupling.removeByApp('example-app')).resolves.toEqual(deleted)

    expect(fetch).toHaveBeenCalledTimes(2)
    expect(requests.map(({headers, method, url}) => ({accept: headers.get('accept'), method, url}))).toEqual([
      {
        accept: 'application/vnd.heroku+json; version=3',
        method: 'GET',
        url: 'https://api.heroku.com/apps/example-app/pipeline-couplings',
      },
      {
        accept: 'application/vnd.heroku+json; version=3',
        method: 'DELETE',
        url: 'https://api.heroku.com/pipeline-couplings/coupling-1',
      },
    ])
  })

  it('registers removeByApp alongside listApps on the existing bundle', () => {
    const {ctx} = ctxWith()
    const methods = pipelineCouplingExtensions.factory(ctx)

    expect(methods).toHaveProperty('removeByApp', expect.any(Function))
    expect(methods).toHaveProperty('listApps', expect.any(Function))
  })

  it('looks up the app then deletes the coupling id and returns the DELETE response exactly', async () => {
    const lookup = {id: 'coupling-1', stage: 'staging'}
    const deleted = {id: 'coupling-1', stage: 'production'}
    const {ctx, deleteCoupling, infoByApp} = ctxWith(vi.fn().mockResolvedValue(lookup), vi.fn().mockResolvedValue(deleted))

    await expect(removeByApp(ctx, 'example-app')).resolves.toBe(deleted)
    expect(infoByApp).toHaveBeenCalledExactlyOnceWith('example-app')
    expect(deleteCoupling).toHaveBeenCalledExactlyOnceWith('coupling-1')
    expect(infoByApp.mock.invocationCallOrder[0]).toBeLessThan(deleteCoupling.mock.invocationCallOrder[0])
  })

  it('invokes removeByApp through the registered bundle', async () => {
    const deleted = {id: 'coupling-1'}
    const {ctx, deleteCoupling} = ctxWith(vi.fn().mockResolvedValue({id: 'coupling-1'}), vi.fn().mockResolvedValue(deleted))

    await expect(pipelineCouplingExtensions.factory(ctx).removeByApp('app-id')).resolves.toBe(deleted)
    expect(deleteCoupling).toHaveBeenCalledExactlyOnceWith('coupling-1')
  })

  it('maps a lookup 404 for a pipeline coupling and preserves message/cause', async () => {
    const resource = 'pipeline_coupling'
    const cause = Object.assign(new Error('Original API not-found message'), {resource, statusCode: 404})
    const {ctx, deleteCoupling} = ctxWith(vi.fn().mockRejectedValue(cause))

    const error = await removeByApp(ctx, 'example-app').catch(error => error)

    expect(error).toBeInstanceOf(CouplingNotFoundError)
    expect(error).toMatchObject({
      body: {id: 'not_found', message: cause.message, resource: 'pipeline_coupling'},
      cause,
      id: 'not_found',
      message: cause.message,
      name: 'CouplingNotFoundError',
      resource: 'pipeline_coupling',
      statusCode: 404,
    })
    expect(error.cause).toBe(cause)
    expect(deleteCoupling).not.toHaveBeenCalled()
  })

  it.each([
    Object.assign(new Error('App missing'), {resource: 'app', statusCode: 404}),
    Object.assign(new Error('Dyno missing'), {resource: 'dyno', statusCode: 404}),
    Object.assign(new Error('Unlabeled not found'), {statusCode: 404}),
    Object.assign(new Error('Unauthorized'), {statusCode: 401}),
    Object.assign(new Error('Forbidden'), {statusCode: 403}),
    Object.assign(new Error('Server failure'), {statusCode: 500}),
    Object.assign(new Error('Pipeline coupling server failure'), {resource: 'pipeline_coupling', statusCode: 500}),
    new TypeError('Network failure'),
    new DOMException('Aborted', 'AbortError'),
  ])('passes lookup error unchanged: $message', async error => {
    const {ctx, deleteCoupling} = ctxWith(vi.fn().mockRejectedValue(error))

    await expect(removeByApp(ctx, 'example-app')).rejects.toBe(error)
    expect(deleteCoupling).not.toHaveBeenCalled()
  })

  it.each([404, 500])('passes DELETE %s unchanged', async statusCode => {
    const error = Object.assign(new Error('Delete failure'), {statusCode})
    const {ctx} = ctxWith(vi.fn().mockResolvedValue({id: 'coupling-1'}), vi.fn().mockRejectedValue(error))

    await expect(removeByApp(ctx, 'example-app')).rejects.toBe(error)
  })

  it.each([{}, {id: ''}, {id: 123}])('rejects malformed coupling %j without deleting', async coupling => {
    const {ctx, deleteCoupling} = ctxWith(vi.fn().mockResolvedValue(coupling))

    await expect(removeByApp(ctx, 'example-app')).rejects.toThrow('Pipeline coupling lookup returned no valid id.')
    expect(deleteCoupling).not.toHaveBeenCalled()
  })

  it('returns an empty DELETE response without falling back to the lookup', async () => {
    const {ctx} = ctxWith(vi.fn().mockResolvedValue({id: 'coupling-1'}), vi.fn(async () => {}))

    expectTypeOf<ReturnType<typeof removeByApp>>().toEqualTypeOf<Promise<PipelineCoupling | undefined>>()
    await expect(removeByApp(ctx, 'example-app')).resolves.toBeUndefined()
  })

  it.each([204, 200])('returns undefined for an empty HTTP %s DELETE response through the dispatcher', async status => {
    vi.stubGlobal('fetch', vi.fn<typeof globalThis.fetch>(async (input, init) => {
      const request = input instanceof Request ? input : new Request(input, init)
      if (request.method === 'GET') {
        return new Response(JSON.stringify({id: 'coupling-1'}), {headers: {'content-type': 'application/json'}})
      }

      if (status === 204) return new Response(null, {status})

      // eslint-disable-next-line n/no-unsupported-features/node-builtins -- Verify SDK handling of an explicitly empty stream.
      return new Response(new ReadableStream({start: controller => controller.close()}), {status})
    }))
    const sdk = new HerokuSDK({clientOptions: {token: 'test-token'}, extensions: [pipelineCouplingExtensions]})
    const result = sdk.platform.pipelineCoupling.removeByApp('example-app')

    expectTypeOf(result).toEqualTypeOf<Promise<PipelineCoupling | undefined>>()
    await expect(result).resolves.toBeUndefined()
  })

  it.each(['operation', 'caller'] as const)('combines both signals bound by withOptions when %s cancels', async source => {
    const operation = new AbortController()
    const caller = new AbortController()
    const {ctx, platform} = ctxWith(vi.fn().mockResolvedValue({id: 'coupling-1'}))
    ctx.operationSignal = operation.signal

    await removeByApp(ctx, 'example-app', {signal: caller.signal})

    expect(platform.withOptions).toHaveBeenCalledExactlyOnceWith({
      headers: {Accept: 'application/vnd.heroku+json; version=3'},
      signal: expect.any(AbortSignal),
    })
    const signal = platform.withOptions.mock.calls[0][0].signal as AbortSignal
    expect(signal).not.toBe(operation.signal)
    expect(signal).not.toBe(caller.signal)
    const reason = new Error(`${source} canceled`)
    const controller = source === 'operation' ? operation : caller
    controller.abort(reason)
    expect(signal.aborted).toBe(true)
    expect(signal.reason).toBe(reason)
    expect((source === 'operation' ? caller : operation).signal.aborted).toBe(false)
  })

  it.each(['operation', 'caller'] as const)('checks both signals before lookup when %s is already aborted', async source => {
    const operation = new AbortController()
    const caller = new AbortController()
    const {ctx, deleteCoupling, infoByApp} = ctxWith()
    ctx.operationSignal = operation.signal
    const reason = new Error(`${source} canceled`)
    const controller = source === 'operation' ? operation : caller
    controller.abort(reason)

    await expect(removeByApp(ctx, 'example-app', {signal: caller.signal})).rejects.toBe(reason)
    expect(infoByApp).not.toHaveBeenCalled()
    expect(deleteCoupling).not.toHaveBeenCalled()
  })

  it.each(['operation', 'caller'] as const)('checks both signals after lookup when %s cancels', async source => {
    const operation = new AbortController()
    const caller = new AbortController()
    const reason = new Error(`${source} canceled`)
    const controller = source === 'operation' ? operation : caller
    const {ctx, deleteCoupling} = ctxWith(vi.fn(async () => {
      controller.abort(reason)
      return {id: 'coupling-1'}
    }))
    ctx.operationSignal = operation.signal

    await expect(removeByApp(ctx, 'example-app', {signal: caller.signal})).rejects.toBe(reason)
    expect(deleteCoupling).not.toHaveBeenCalled()
  })

  it.each([
    ['operation', 'GET'], ['caller', 'GET'], ['operation', 'DELETE'], ['caller', 'DELETE'],
  ] as const)('aborts the in-flight %s signal on %s through SDK withOptions', async (source, method) => {
    const operation = new AbortController()
    const caller = new AbortController()
    const reason = new Error(`${source} canceled`)
    const controller = source === 'operation' ? operation : caller
    const requests: Request[] = []
    vi.stubGlobal('fetch', vi.fn<typeof globalThis.fetch>(async (input, init) => {
      const request = input instanceof Request ? input : new Request(input, init)
      requests.push(request)
      if (request.method === method) {
        controller.abort(reason)
        request.signal.throwIfAborted()
      }

      return new Response(JSON.stringify({id: 'coupling-1'}), {headers: {'content-type': 'application/json'}})
    }))
    const sdk = new HerokuSDK({clientOptions: {token: 'test-token'}, extensions: [pipelineCouplingExtensions]})
    const scoped = sdk.platform.withOptions({signal: operation.signal}) as typeof sdk.platform

    await expect(scoped.pipelineCoupling.removeByApp('example-app', {
      signal: caller.signal,
    })).rejects.toBe(reason)
    expect(requests.map(request => request.method)).toEqual(method === 'GET' ? ['GET'] : ['GET', 'DELETE'])
    expect(requests.every(request => request.signal.aborted && request.signal.reason === reason)).toBe(true)
    expect((source === 'operation' ? caller : operation).signal.aborted).toBe(false)
  })

  it('binds the signal to both requests', async () => {
    const {ctx, platform} = ctxWith(vi.fn().mockResolvedValue({id: 'coupling-1'}), vi.fn().mockResolvedValue({id: 'coupling-1'}))
    const {signal} = new AbortController()

    await removeByApp(ctx, 'example-app', {signal})

    expect(platform.withOptions).toHaveBeenCalledExactlyOnceWith({
      headers: {Accept: 'application/vnd.heroku+json; version=3'},
      signal,
    })
  })

  it('stops an already-aborted operation before lookup', async () => {
    const {ctx, deleteCoupling, infoByApp} = ctxWith()
    const controller = new AbortController()
    controller.abort()

    await expect(removeByApp(ctx, 'example-app', {signal: controller.signal})).rejects.toBe(controller.signal.reason)
    expect(infoByApp).not.toHaveBeenCalled()
    expect(deleteCoupling).not.toHaveBeenCalled()
  })

  it('stops cancellation after lookup before DELETE', async () => {
    const controller = new AbortController()
    const {ctx, deleteCoupling} = ctxWith(vi.fn().mockImplementation(async () => {
      controller.abort()
      return {id: 'coupling-1'}
    }))

    await expect(removeByApp(ctx, 'example-app', {signal: controller.signal})).rejects.toBe(controller.signal.reason)
    expect(deleteCoupling).not.toHaveBeenCalled()
  })
})
