import {NotFoundError, RateLimitError} from '@heroku/heroku-fetch'
import {
  describe, expect, it, vi,
} from 'vitest'

import type {ResourceCtx} from '../../../core/extend-resource.js'

import {diffApps} from './diff.js'

function ctx(platform: unknown): ResourceCtx {
  return {data: {} as never, metrics: {} as never, platform: platform as never}
}

// Per-app fixture: each key holds the raw shape the corresponding platform
// method resolves to for that app identity. Anything omitted falls back to a
// benign default that produces NO diff row (empty config, equal stacks, no
// releases/buildpacks/addons/features), so a focused test only has to populate
// the single aspect it exercises.
type AppData = {
  addons?: {addon_service?: {name?: string}}[]
  appInfo?: {stack?: {name?: string}}
  buildpacks?: {buildpack?: {url?: string}}[]
  config?: Record<string, string>
  features?: {enabled?: boolean; name?: string}[]
  releases?: {slug?: {id?: string}}[]
  slug?: {checksum?: null | string}
}

function resources(byApp: Record<string, AppData>) {
  const dataFor = (app: string): AppData => byApp[app] ?? {}
  return {
    addOn: {listByApp: vi.fn(async (app: string) => dataFor(app).addons ?? [])},
    app: {info: vi.fn(async (app: string) => dataFor(app).appInfo ?? {stack: {name: 'heroku-24'}})},
    appFeature: {list: vi.fn(async (app: string) => dataFor(app).features ?? [])},
    buildpackInstallation: {list: vi.fn(async (app: string) => dataFor(app).buildpacks ?? [])},
    configVar: {infoForApp: vi.fn(async (app: string) => dataFor(app).config ?? {})},
    release: {list: vi.fn(async (app: string) => dataFor(app).releases ?? [])},
    slug: {info: vi.fn(async (app: string, _slugId: string) => dataFor(app).slug ?? {checksum: null})},
  }
}

// A platform whose `withHeaders` returns itself (so the Range-scoped
// `.release.list` resolves on the same fake) and whose `withOptions` is wired
// by fakePlatform to a separate scoped copy for signal-threading assertions.
function buildPlatform(byApp: Record<string, AppData>) {
  const platform = {
    ...resources(byApp),
    withHeaders: vi.fn(),
    withOptions: vi.fn(),
  }
  platform.withHeaders.mockReturnValue(platform)
  return platform
}

// Raw + scoped fakes wired through withOptions, mirroring transfer.test.ts:
// tests can assert which client a dispatch landed on (raw vs. signal-scoped).
function fakePlatform(byApp: Record<string, AppData> = {}) {
  const scoped = buildPlatform(byApp)
  const platform = buildPlatform(byApp)
  platform.withOptions.mockReturnValue(scoped)
  return {platform, scoped}
}

describe('diffApps', () => {
  it('emits a slug (checksum) row when the latest releases differ', async () => {
    const {platform} = fakePlatform({
      app1: {releases: [{slug: {id: 's1'}}], slug: {checksum: 'sha1'}},
      app2: {releases: [{slug: {id: 's2'}}], slug: {checksum: 'sha2'}},
    })
    const rows = await diffApps(ctx(platform), 'app1', 'app2')
    expect(platform.withHeaders).toHaveBeenCalledWith({Range: 'version ..; max=1, order=desc'})
    expect(platform.release.list).toHaveBeenCalledWith('app1')
    expect(platform.release.list).toHaveBeenCalledWith('app2')
    expect(platform.slug.info).toHaveBeenCalledWith('app1', 's1')
    expect(platform.slug.info).toHaveBeenCalledWith('app2', 's2')
    expect(rows).toEqual([{app1: 'sha1', app2: 'sha2', prop: 'slug (checksum)'}])
  })

  it('emits no slug row when the two checksums are equal', async () => {
    const {platform} = fakePlatform({
      app1: {releases: [{slug: {id: 's1'}}], slug: {checksum: 'same'}},
      app2: {releases: [{slug: {id: 's2'}}], slug: {checksum: 'same'}},
    })
    const rows = await diffApps(ctx(platform), 'app1', 'app2')
    expect(rows).toEqual([])
  })

  it('coerces a null checksum to undefined in the emitted row', async () => {
    const {platform} = fakePlatform({
      app1: {releases: [{slug: {id: 's1'}}], slug: {checksum: 'sha1'}},
      // No releases → checksum resolves to null → app2 becomes undefined.
      app2: {},
    })
    const rows = await diffApps(ctx(platform), 'app1', 'app2')
    expect(rows).toEqual([{app1: 'sha1', app2: undefined, prop: 'slug (checksum)'}])
  })

  it('emits a config row only for keys whose values differ (union of both apps)', async () => {
    const {platform} = fakePlatform({
      app1: {config: {A: '1', SHARED: 'x'}},
      app2: {config: {B: '2', SHARED: 'x'}},
    })
    const rows = await diffApps(ctx(platform), 'app1', 'app2')
    expect(platform.configVar.infoForApp).toHaveBeenCalledWith('app1')
    expect(platform.configVar.infoForApp).toHaveBeenCalledWith('app2')
    // SHARED is equal → excluded. A is only on app1, B only on app2.
    expect(rows).toEqual([
      {app1: '1', app2: undefined, prop: 'config (A)'},
      {app1: undefined, app2: '2', prop: 'config (B)'},
    ])
  })

  it('emits a stack row when stack names differ', async () => {
    const {platform} = fakePlatform({
      app1: {appInfo: {stack: {name: 'heroku-24'}}},
      app2: {appInfo: {stack: {name: 'heroku-22'}}},
    })
    const rows = await diffApps(ctx(platform), 'app1', 'app2')
    expect(rows).toEqual([{app1: 'heroku-24', app2: 'heroku-22', prop: 'stack'}])
  })

  it('emits no stack row when stack names are equal', async () => {
    const {platform} = fakePlatform({
      app1: {appInfo: {stack: {name: 'heroku-24'}}},
      app2: {appInfo: {stack: {name: 'heroku-24'}}},
    })
    const rows = await diffApps(ctx(platform), 'app1', 'app2')
    expect(rows).toEqual([])
  })

  it('positionally compares buildpack urls and emits only differing indices', async () => {
    const {platform} = fakePlatform({
      app1: {buildpacks: [{buildpack: {url: 'nodejs'}}, {buildpack: {url: 'python'}}]},
      app2: {buildpacks: [{buildpack: {url: 'nodejs'}}, {buildpack: {url: 'ruby'}}]},
    })
    const rows = await diffApps(ctx(platform), 'app1', 'app2')
    // Index 0 (nodejs) is equal → excluded; index 1 differs.
    expect(rows).toEqual([{app1: 'python', app2: 'ruby', prop: 'buildpack (1)'}])
  })

  it('pads the shorter buildpack list so extra entries surface as undefined', async () => {
    const {platform} = fakePlatform({
      app1: {buildpacks: [{buildpack: {url: 'nodejs'}}, {buildpack: {url: 'python'}}]},
      app2: {buildpacks: [{buildpack: {url: 'nodejs'}}]},
    })
    const rows = await diffApps(ctx(platform), 'app1', 'app2')
    expect(rows).toEqual([{app1: 'python', app2: undefined, prop: 'buildpack (1)'}])
  })

  it('emits add-on rows via set-difference of addon_service names', async () => {
    const {platform} = fakePlatform({
      // eslint-disable-next-line camelcase
      app1: {addons: [{addon_service: {name: 'heroku-postgresql'}}, {addon_service: {name: 'heroku-redis'}}]},
      // eslint-disable-next-line camelcase
      app2: {addons: [{addon_service: {name: 'heroku-postgresql'}}, {addon_service: {name: 'heroku-kafka'}}]},
    })
    const rows = await diffApps(ctx(platform), 'app1', 'app2')
    expect(platform.addOn.listByApp).toHaveBeenCalledWith('app1')
    expect(platform.addOn.listByApp).toHaveBeenCalledWith('app2')
    // Shared postgresql is excluded; only-on-app1 then only-on-app2.
    expect(rows).toEqual([
      {app1: 'true', app2: 'false', prop: 'add-on (heroku-redis)'},
      {app1: 'false', app2: 'true', prop: 'add-on (heroku-kafka)'},
    ])
  })

  it('emits feature rows via set-difference of ENABLED features only', async () => {
    const {platform} = fakePlatform({
      app1: {
        features: [
          {enabled: true, name: 'a'},
          {enabled: false, name: 'b'}, // disabled → never counted
          {enabled: true, name: 'd'},
        ],
      },
      app2: {
        features: [
          {enabled: true, name: 'a'},
          {enabled: true, name: 'c'},
        ],
      },
    })
    const rows = await diffApps(ctx(platform), 'app1', 'app2')
    // Shared enabled 'a' excluded; 'b' is disabled so ignored entirely.
    expect(rows).toEqual([
      {app1: 'enabled', app2: 'disabled', prop: 'feature (d)'},
      {app1: 'disabled', app2: 'enabled', prop: 'feature (c)'},
    ])
  })

  it('combines every aspect in the order slug, config, stack, buildpack, add-on, feature', async () => {
    const {platform} = fakePlatform({
      app1: {
        // eslint-disable-next-line camelcase
        addons: [{addon_service: {name: 'pg'}}],
        appInfo: {stack: {name: 'heroku-24'}},
        buildpacks: [{buildpack: {url: 'nodejs-url'}}],
        config: {A: '1'},
        features: [{enabled: true, name: 'f1'}],
        releases: [{slug: {id: 's1'}}],
        slug: {checksum: 'sum1'},
      },
      app2: {
        addons: [],
        appInfo: {stack: {name: 'heroku-22'}},
        buildpacks: [{buildpack: {url: 'python-url'}}],
        config: {A: '2'},
        features: [],
        releases: [{slug: {id: 's2'}}],
        slug: {checksum: 'sum2'},
      },
    })
    const rows = await diffApps(ctx(platform), 'app1', 'app2')
    expect(rows).toEqual([
      {app1: 'sum1', app2: 'sum2', prop: 'slug (checksum)'},
      {app1: '1', app2: '2', prop: 'config (A)'},
      {app1: 'heroku-24', app2: 'heroku-22', prop: 'stack'},
      {app1: 'nodejs-url', app2: 'python-url', prop: 'buildpack (0)'},
      {app1: 'true', app2: 'false', prop: 'add-on (pg)'},
      {app1: 'enabled', app2: 'disabled', prop: 'feature (f1)'},
    ])
  })

  it('throws "App not found" when release.list rejects with a NotFoundError', async () => {
    const {platform} = fakePlatform()
    platform.release.list.mockImplementation(async (app: string) => {
      if (app === 'ghost') {
        throw new NotFoundError(new Response(null, {status: 404}))
      }

      return []
    })
    await expect(diffApps(ctx(platform), 'ghost', 'other')).rejects.toThrow('App not found: ghost')
  })

  it('throws "App not found" when slug.info rejects with a NotFoundError', async () => {
    const {platform} = fakePlatform({
      app1: {releases: [{slug: {id: 's1'}}]},
      app2: {releases: [{slug: {id: 's2'}}]},
    })
    platform.slug.info.mockImplementation(async (app: string) => {
      if (app === 'app1') {
        throw new NotFoundError(new Response(null, {status: 404}))
      }

      return {checksum: 'sha'}
    })
    await expect(diffApps(ctx(platform), 'app1', 'app2')).rejects.toThrow('App not found: app1')
  })

  it('re-throws a non-404 error unchanged', async () => {
    const {platform} = fakePlatform()
    // A real SDK API error that is NOT a NotFoundError must flow through
    // untouched — proving the guard is NotFoundError-specific, not "any API error".
    const boom = new RateLimitError(new Response(null, {status: 429}))
    platform.release.list.mockRejectedValue(boom)
    await expect(diffApps(ctx(platform), 'app1', 'app2')).rejects.toThrow()
    await expect(diffApps(ctx(platform), 'app1', 'app2')).rejects.not.toThrow('App not found')
  })

  it('honors an already-aborted signal pre-flight and dispatches nothing', async () => {
    const {platform, scoped} = fakePlatform()
    const call = diffApps(ctx(platform), 'app1', 'app2', {signal: AbortSignal.abort()})
    await expect(call).rejects.toThrow()
    // Nothing on either the raw or scoped client should have been touched —
    // proves the rejection came from the pre-flight throwIfAborted().
    for (const p of [platform, scoped]) {
      expect(p.release.list).not.toHaveBeenCalled()
      expect(p.slug.info).not.toHaveBeenCalled()
      expect(p.configVar.infoForApp).not.toHaveBeenCalled()
      expect(p.app.info).not.toHaveBeenCalled()
      expect(p.buildpackInstallation.list).not.toHaveBeenCalled()
      expect(p.addOn.listByApp).not.toHaveBeenCalled()
      expect(p.appFeature.list).not.toHaveBeenCalled()
    }
  })

  it('threads the signal into a scoped client and dispatches on it', async () => {
    const {platform, scoped} = fakePlatform({
      app1: {appInfo: {stack: {name: 'heroku-24'}}},
      app2: {appInfo: {stack: {name: 'heroku-22'}}},
    })
    const {signal} = new AbortController()
    const rows = await diffApps(ctx(platform), 'app1', 'app2', {signal})
    expect(platform.withOptions).toHaveBeenCalledWith({signal})
    // Dispatch lands on the scoped client, not the raw one.
    expect(scoped.app.info).toHaveBeenCalledWith('app1')
    expect(platform.app.info).not.toHaveBeenCalled()
    expect(rows).toEqual([{app1: 'heroku-24', app2: 'heroku-22', prop: 'stack'}])
  })

  it('does not scope the client when no signal is given', async () => {
    const {platform} = fakePlatform({
      app1: {appInfo: {stack: {name: 'heroku-24'}}},
      app2: {appInfo: {stack: {name: 'heroku-22'}}},
    })
    await diffApps(ctx(platform), 'app1', 'app2', {})
    expect(platform.withOptions).not.toHaveBeenCalled()
    expect(platform.app.info).toHaveBeenCalledWith('app1')
  })
})
