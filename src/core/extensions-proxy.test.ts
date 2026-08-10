import {
  describe, expect, it, vi,
} from 'vitest'

import type {ResourceCtx, ResourceExtension} from './extend-resource.js'

import {extendResource} from './extend-resource.js'
import {mergeExtensions} from './extensions-proxy.js'

function fakeCtx(): ResourceCtx {
  return {data: {} as never, platform: {} as never}
}

describe('mergeExtensions', () => {
  it('passes through unknown resources unchanged (returns undefined)', () => {
    const routes = {} as Record<string, unknown>
    const merged = mergeExtensions(routes, [], fakeCtx())
    expect((merged as Record<string, unknown>).nope).toBeUndefined()
  })

  it('returns route resources untouched when no extensions register for them', () => {
    const update = vi.fn()
    const routes = {app: {update}} as Record<string, unknown>
    const merged = mergeExtensions(routes, [], fakeCtx()) as {app: {update: typeof update}}
    expect(merged.app.update).toBe(update)
  })

  it('exposes extension-only resources when no route resource exists', () => {
    const ext: ResourceExtension = extendResource('platform', 'newThing', () => ({
      hello: () => 'world',
    }))
    const merged = mergeExtensions({} as Record<string, unknown>, [ext], fakeCtx())
    const {newThing} = (merged as {newThing: {hello: () => string}})
    expect(newThing.hello()).toBe('world')
  })

  it('merges extension methods onto an existing route resource (extension wins on collision)', () => {
    const routeUpdate = vi.fn().mockReturnValue('route-update')
    const routeInfo = vi.fn().mockReturnValue('route-info')
    const routes = {app: {info: routeInfo, update: routeUpdate}} as Record<string, unknown>

    const ext = extendResource('platform', 'app', () => ({
      enableMaintenance: () => 'extension-maintenance',
      update: () => 'extension-update',
    }))

    const merged = mergeExtensions(routes, [ext], fakeCtx()) as {
      app: {
        enableMaintenance: () => string;
        info: () => string;
        update: () => string;
      };
    }

    expect(merged.app.enableMaintenance()).toBe('extension-maintenance')
    expect(merged.app.update()).toBe('extension-update')
    expect(merged.app.info()).toBe('route-info')
  })

  it('combines methods from multiple extensions targeting the same resource', () => {
    const ext1 = extendResource('platform', 'app', () => ({a: () => 1}))
    const ext2 = extendResource('platform', 'app', () => ({b: () => 2}))

    const merged = mergeExtensions({} as Record<string, unknown>, [ext1, ext2], fakeCtx()) as {
      app: {a: () => number; b: () => number};
    }
    expect(merged.app.a()).toBe(1)
    expect(merged.app.b()).toBe(2)
  })

  it('passes ctx through to the factory', () => {
    const ctx = fakeCtx()
    const factory = vi.fn().mockReturnValue({})
    const ext: ResourceExtension = {factory, resource: 'app', service: 'platform'}

    mergeExtensions({} as Record<string, unknown>, [ext], ctx)
    expect(factory).toHaveBeenCalledWith(ctx)
  })

  it('invokes each extension factory exactly once regardless of access count', () => {
    const factory = vi.fn().mockReturnValue({hello: () => 'x'})
    const ext: ResourceExtension = {factory, resource: 'app', service: 'platform'}
    const merged = mergeExtensions({} as Record<string, unknown>, [ext], fakeCtx()) as {
      app: {hello: () => string};
    }
    merged.app.hello()
    merged.app.hello()
    // Touching the resource property again should not re-invoke the factory.
    const _touch = merged.app
    expect(_touch).toBeDefined()
    expect(factory).toHaveBeenCalledTimes(1)
  })

  it('preserves extension methods after withOptions', () => {
    const ext = extendResource('platform', 'app', () => ({hello: () => 'world'}))
    const inner = {app: {info: vi.fn()}}
    const withOptions = vi.fn().mockReturnValue(inner)
    const routes = {app: {info: vi.fn()}, withOptions} as Record<string, unknown>

    const merged = mergeExtensions(routes, [ext], fakeCtx()) as {
      app: {hello: () => string};
      withOptions: (opts: object) => {app: {hello: () => string}};
    }

    const {signal} = new AbortController()
    const scoped = merged.withOptions({signal})

    expect(withOptions).toHaveBeenCalledWith({signal})
    expect(scoped.app.hello()).toBe('world')
  })

  it('preserves extension methods after withHeaders', () => {
    const ext = extendResource('platform', 'app', () => ({hello: () => 'world'}))
    const inner = {app: {info: vi.fn()}}
    const withHeaders = vi.fn().mockReturnValue(inner)
    const routes = {app: {info: vi.fn()}, withHeaders} as Record<string, unknown>

    const merged = mergeExtensions(routes, [ext], fakeCtx()) as {
      app: {hello: () => string};
      withHeaders: (headers: object) => {app: {hello: () => string}};
    }

    const scoped = merged.withHeaders({Accept: 'application/vnd.heroku+json; version=3'})

    expect(withHeaders).toHaveBeenCalledWith({Accept: 'application/vnd.heroku+json; version=3'})
    expect(scoped.app.hello()).toBe('world')
  })

  // Unlike the `() => ({hello: ...})` factories above, these read `ctx.platform`
  // — the trivial stubs ignore ctx, so they can't catch an extension resolving
  // the raw client and dropping the sticky options after withOptions/withHeaders.

  type FakePlatform = {
    someResource: {someMethod: () => string};
    withHeaders: (headers: object) => FakePlatform;
    withOptions: (opts: object) => FakePlatform;
  }

  // Builds a fake platform client. The root exposes `withOptions`/`withHeaders`
  // that return a DERIVED stub distinguishable from the raw one, and records
  // the options/headers it was created with.
  function makeFakePlatform(tag: string, seenOpts: object[], seenHeaders: object[]): FakePlatform {
    const client: FakePlatform = {
      someResource: {someMethod: () => tag},
      withHeaders(headers: object) {
        seenHeaders.push(headers)
        return makeFakePlatform('DERIVED', seenOpts, seenHeaders)
      },
      withOptions(opts: object) {
        seenOpts.push(opts)
        return makeFakePlatform('DERIVED', seenOpts, seenHeaders)
      },
    }
    return client
  }

  it('routes extension methods through the derived client after withOptions', () => {
    const seenOpts: object[] = []
    const seenHeaders: object[] = []
    const raw = makeFakePlatform('RAW', seenOpts, seenHeaders)
    // ctx.platform must be the SAME object as the client passed to
    // mergeExtensions so the un-fixed code (recursing with the original ctx)
    // would resolve to RAW.
    const ctx = {platform: raw} as unknown as ResourceCtx

    const ext = extendResource('platform', 'someResource', c => ({
      ping: () => c.platform.someResource.someMethod(),
    }))

    const merged = mergeExtensions(raw, [ext], ctx) as unknown as FakePlatform & {
      someResource: {ping: () => string; someMethod: () => string};
      withOptions: (opts: object) => FakePlatform & {someResource: {ping: () => string}};
    }

    // Pre-existing behavior: extension method present before scoping.
    expect(merged.someResource.ping()).toBe('RAW')

    const {signal} = new AbortController()
    const scoped = merged.withOptions({signal})

    expect(seenOpts).toContainEqual({signal})
    // The extension read ctx.platform — with the fix this is the DERIVED client.
    expect(scoped.someResource.ping()).toBe('DERIVED')
  })

  it('routes extension methods through the derived client after withHeaders', () => {
    const seenOpts: object[] = []
    const seenHeaders: object[] = []
    const raw = makeFakePlatform('RAW', seenOpts, seenHeaders)
    const ctx = {platform: raw} as unknown as ResourceCtx

    const ext = extendResource('platform', 'someResource', c => ({
      ping: () => c.platform.someResource.someMethod(),
    }))

    const merged = mergeExtensions(raw, [ext], ctx) as unknown as FakePlatform & {
      withHeaders: (headers: object) => FakePlatform & {someResource: {ping: () => string}};
    }

    const headers = {Accept: 'application/vnd.heroku+json; version=3'}
    const scoped = merged.withHeaders(headers)

    expect(seenHeaders).toContainEqual(headers)
    expect(scoped.someResource.ping()).toBe('DERIVED')
  })

  it('routes extension methods through the derived client after chained withOptions().withHeaders()', () => {
    const seenOpts: object[] = []
    const seenHeaders: object[] = []
    const raw = makeFakePlatform('RAW', seenOpts, seenHeaders)
    const ctx = {platform: raw} as unknown as ResourceCtx

    const ext = extendResource('platform', 'someResource', c => ({
      ping: () => c.platform.someResource.someMethod(),
    }))

    const merged = mergeExtensions(raw, [ext], ctx) as unknown as FakePlatform & {
      withOptions: (opts: object) => FakePlatform & {
        someResource: {ping: () => string};
        withHeaders: (headers: object) => FakePlatform & {someResource: {ping: () => string}};
      };
    }

    const {signal} = new AbortController()
    const headers = {Accept: 'application/vnd.heroku+json; version=3'}
    const scoped = merged.withOptions({signal}).withHeaders(headers)

    expect(seenOpts).toContainEqual({signal})
    expect(seenHeaders).toContainEqual(headers)
    expect(scoped.someResource.ping()).toBe('DERIVED')
  })
})
