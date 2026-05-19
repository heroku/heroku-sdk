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
})
