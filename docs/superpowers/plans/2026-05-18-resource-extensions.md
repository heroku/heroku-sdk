# Resource Extensions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an `extendResource` mechanism plus a `HerokuSDK` class that merges hand-written resource methods with upstream `@heroku/types` route methods, then migrate every existing composition into the new structure while keeping `compositions/` working as a deprecated alias.

**Architecture:** A three-layer runtime — raw service clients (unchanged), resource modules that pair tree-shakable named functions with `extendResource` bundles, and a `HerokuSDK` class that exposes namespace-merged service views via `Proxy`. Extension descriptors are values (no module side effects); consumers register them explicitly at SDK construction.

**Tech Stack:** TypeScript 6, ESM, vitest, `@heroku/api-client`, `@heroku/types`.

**Spec:** `docs/superpowers/specs/2026-05-18-resource-extensions-design.md`

---

## File structure

### Created

| Path | Responsibility |
|------|----------------|
| `src/core/extend-resource.ts` | `extendResource` function; `ServiceName`, `ResourceCtx`, `ResourceExtension` types; type utilities (`UnionToIntersection`, `ExtensionsFor`, `MethodsForResource`, `ApplyExtensions`). |
| `src/core/extend-resource.test.ts` | Unit tests for `extendResource` descriptor shape and literal-type preservation. |
| `src/core/extensions-proxy.ts` | `mergeExtensions` Proxy that overlays extension methods onto a raw routes proxy. |
| `src/core/extensions-proxy.test.ts` | Unit tests for `mergeExtensions` covering all branches. |
| `src/resources/platform/app.ts` | `enableMaintenance`/`disableMaintenance` named functions + `appExtensions`. |
| `src/resources/platform/app.test.ts` | Unit tests for the new layer. |
| `src/resources/platform/dyno.ts` | `scaleDynos`/`restartDynos` named functions + `dynoExtensions`. |
| `src/resources/platform/dyno.test.ts` | Unit tests. |
| `src/resources/platform/pipeline-promotion.ts` | `promotePipeline` named function (with internal polling) + `pipelinePromotionExtensions`. |
| `src/resources/platform/pipeline-promotion.test.ts` | Unit tests. |
| `src/resources/data/database.ts` | `describe`/`runUpgrade`/`prepareUpgrade` named functions + `databaseExtensions`. |
| `src/resources/data/database.test.ts` | Unit tests. |
| `src/resources/data/postgres-database.ts` | `listCredentials` named function + `postgresDatabaseExtensions`. |
| `src/resources/data/postgres-database.test.ts` | Unit tests. |
| `src/resources/data/maintenance.ts` | `info` named function + `maintenanceExtensions`. |
| `src/resources/data/maintenance.test.ts` | Unit tests. |
| `src/resources/data/internal/resolve-addon-id.ts` | Shared helper for cross-service add-on resolution. |
| `src/resources/extensions/platform.ts` | Curated barrel re-exporting platform `*Extensions`. |
| `src/resources/extensions/platform.test.ts` | Glob-driven barrel-completeness test. |
| `src/resources/extensions/data.ts` | Curated barrel re-exporting data `*Extensions`. |
| `src/resources/extensions/data.test.ts` | Glob-driven barrel-completeness test. |
| `examples/sdk-usage.ts` | Example showing `new HerokuSDK({ extensions: [...] })`. |
| `examples/sdk-tree-shaken.ts` | Example showing the named-function path. |

### Modified

| Path | Change |
|------|--------|
| `src/core/heroku-sdk.ts` | Replace placeholder with full `HerokuSDK` class (generic, lazy, Proxy-merged). |
| `src/compositions/app.ts` | Convert to transitional alias delegating to `src/resources/platform/app.ts`. |
| `src/compositions/dyno.ts` | Same pattern. |
| `src/compositions/pipeline.ts` | Same pattern. |
| `src/compositions/pg.ts` | Same pattern, fanned out across data resource files. |
| `package.json` | Add subpath exports (`./sdk`, `./extensions/*`, `./resources/*`); add `"sideEffects": false`. |
| `CLAUDE.md` | Update Architecture section: three-layer model, `compositions/` deprecation. |

### Deleted

| Path | Reason |
|------|--------|
| `src/core/resource.ts` | Empty placeholder file from the working tree. Removed in Task 1 to avoid confusion with the new `extend-resource.ts`. |

---

## Conventions

- **Imports.** Match the existing file's style. New files in `src/core/` follow `import {createClient} from '../core/create-client.js'` (no spaces inside braces, `.js` extension required by ESM emit).
- **Test layout.** Co-located `*.test.ts` next to the implementation. Mock `@heroku/api-client` via `vi.mock(...)` only when the test exercises a service factory or the full SDK; resource and named-function tests should pass shape-matched fakes directly.
- **Commit messages.** Conventional commits, matching the repo's existing style (`feat(core):`, `feat(resources):`, `refactor(compositions):`, `docs(...)`, `test(...)`).
- **Run scope.** Run only the tests for the file you just changed during inner-loop iteration: `npm test -- <path>`. Run the full suite (`npm test`) before committing.

---

# Phase 1 — Core scaffolding (Step 1 from the spec)

This phase produces a working `HerokuSDK` with no extensions registered. After it lands, the public API is unchanged for existing consumers; the new symbols are importable but unused.

---

### Task 1: Define `extendResource` and its types

**Files:**
- Delete: `src/core/resource.ts` (empty placeholder)
- Create: `src/core/extend-resource.ts`
- Create: `src/core/extend-resource.test.ts`

- [ ] **Step 1.1: Delete the empty placeholder file**

```bash
rm src/core/resource.ts
```

- [ ] **Step 1.2: Write the failing test**

Create `src/core/extend-resource.test.ts`:

```ts
import {describe, expect, it} from 'vitest'

import {extendResource} from './extend-resource.js'

describe('extendResource', () => {
  it('returns a descriptor with service, resource, and factory fields', () => {
    const factory = () => ({foo: () => 'bar'})
    const ext = extendResource('platform', 'app', factory)

    expect(ext.service).toBe('platform')
    expect(ext.resource).toBe('app')
    expect(ext.factory).toBe(factory)
  })

  it('factory is invoked with the supplied ctx and returns the methods record', () => {
    const ctx = {platform: {marker: 'p'} as any, data: {marker: 'd'} as any}
    const ext = extendResource('data', 'database', (received) => ({
      identify: () => received,
    }))

    const methods = ext.factory(ctx)
    expect(methods.identify()).toBe(ctx)
  })
})
```

- [ ] **Step 1.3: Run the test to confirm it fails**

Run: `npm test -- src/core/extend-resource.test.ts`
Expected: FAIL — `Cannot find module './extend-resource.js'`.

- [ ] **Step 1.4: Implement `extend-resource.ts`**

Create `src/core/extend-resource.ts`:

```ts
import type {DataClient} from '../services/data.js'
import type {PlatformClient} from '../services/platform.js'

export type ServiceName = 'platform' | 'data'

export type ResourceCtx = {
  platform: PlatformClient
  data: DataClient
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ResourceMethods = Record<string, (...args: any[]) => any>

export type ResourceExtension<
  S extends ServiceName = ServiceName,
  R extends string = string,
  M extends ResourceMethods = ResourceMethods,
> = {
  service: S
  resource: R
  factory: (ctx: ResourceCtx) => M
}

export function extendResource<
  S extends ServiceName,
  R extends string,
  M extends ResourceMethods,
>(
  service: S,
  resource: R,
  factory: (ctx: ResourceCtx) => M,
): ResourceExtension<S, R, M> {
  return {service, resource, factory}
}

// --- Type utilities used by HerokuSDK to project extensions onto service types ---

export type UnionToIntersection<U> =
  (U extends unknown ? (k: U) => void : never) extends (k: infer I) => void ? I : never

export type ExtensionsFor<
  Exts extends readonly ResourceExtension[],
  S extends ServiceName,
> = Extract<Exts[number], ResourceExtension<S, string, ResourceMethods>>

export type MethodsForResource<E, R extends string> =
  UnionToIntersection<E extends ResourceExtension<ServiceName, R, infer M> ? M : never>

type ResourceKeysOf<E> = E extends ResourceExtension<ServiceName, infer R, ResourceMethods> ? R : never

export type ApplyExtensions<Base, E> =
  & {
    [K in keyof Base]: K extends ResourceKeysOf<E>
      ? Base[K] & MethodsForResource<E, K & string>
      : Base[K]
  }
  & {
    [K in ResourceKeysOf<E> as K extends keyof Base ? never : K]:
      MethodsForResource<E, K & string>
  }
```

Note: `PlatformClient` and `DataClient` already export `HerokuClient` types from `@heroku/types/3.sdk` and `@heroku/types/data` respectively (see `src/services/platform.ts` and `src/services/data.ts`).

- [ ] **Step 1.5: Run the test to confirm it passes**

Run: `npm test -- src/core/extend-resource.test.ts`
Expected: PASS — both tests green.

- [ ] **Step 1.6: Commit**

```bash
git add src/core/extend-resource.ts src/core/extend-resource.test.ts
git rm src/core/resource.ts
git commit -m "feat(core): add extendResource and ApplyExtensions type utilities"
```

---

### Task 2: Implement `mergeExtensions` Proxy

**Files:**
- Create: `src/core/extensions-proxy.ts`
- Create: `src/core/extensions-proxy.test.ts`

- [ ] **Step 2.1: Write the failing test**

Create `src/core/extensions-proxy.test.ts`:

```ts
import {describe, expect, it, vi} from 'vitest'

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
    const newThing = (merged as {newThing: {hello: () => string}}).newThing
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
})
```

- [ ] **Step 2.2: Run the test to confirm it fails**

Run: `npm test -- src/core/extensions-proxy.test.ts`
Expected: FAIL — `Cannot find module './extensions-proxy.js'`.

- [ ] **Step 2.3: Implement `mergeExtensions`**

Create `src/core/extensions-proxy.ts`:

```ts
import createDebug from 'debug'

import type {ResourceCtx, ResourceExtension, ResourceMethods} from './extend-resource.js'

const debug = createDebug('heroku:sdk:extensions')

export function mergeExtensions<T extends object>(
  routesProxy: T,
  extensions: readonly ResourceExtension[],
  ctx: ResourceCtx,
): T {
  const methodsByResource = new Map<string, ResourceMethods>()

  for (const ext of extensions) {
    const merged = methodsByResource.get(ext.resource) ?? {}
    Object.assign(merged, ext.factory(ctx))
    methodsByResource.set(ext.resource, merged)
  }

  for (const [resource, methods] of methodsByResource) {
    const routeResource = (routesProxy as Record<string, unknown>)[resource]
    if (routeResource && typeof routeResource === 'object') {
      for (const methodName of Object.keys(methods)) {
        if (methodName in routeResource) {
          debug('extension shadows upstream route: %s.%s', resource, methodName)
        }
      }
    }
  }

  return new Proxy(routesProxy, {
    get(target, resourceKey: string, receiver) {
      const extMethods = methodsByResource.get(resourceKey)
      const routeResource = Reflect.get(target, resourceKey, receiver)

      if (!extMethods) {
        return routeResource
      }

      return new Proxy(routeResource ?? {}, {
        get(routeTarget, methodKey: string, methodReceiver) {
          if (Object.hasOwn(extMethods, methodKey)) {
            return extMethods[methodKey]
          }

          return Reflect.get(routeTarget, methodKey, methodReceiver)
        },
      })
    },
  })
}
```

- [ ] **Step 2.4: Run the test to confirm it passes**

Run: `npm test -- src/core/extensions-proxy.test.ts`
Expected: PASS — all six tests green.

- [ ] **Step 2.5: Commit**

```bash
git add src/core/extensions-proxy.ts src/core/extensions-proxy.test.ts
git commit -m "feat(core): add mergeExtensions proxy that overlays extensions on routes"
```

---

### Task 3: Replace the placeholder `HerokuSDK` with the real class

**Files:**
- Modify: `src/core/heroku-sdk.ts` (full rewrite)
- Create: `src/core/heroku-sdk.test.ts`

- [ ] **Step 3.1: Write the failing test**

Create `src/core/heroku-sdk.test.ts`:

```ts
import {afterEach, describe, expect, it, vi} from 'vitest'

const platformConstructorSpy = vi.fn()
const dataConstructorSpy = vi.fn()

vi.mock('@heroku/api-client', () => ({
  HerokuApiClient: class {
    constructor(options: unknown) {
      // The same constructor is used for platform and data; spies are
      // distinguished by the service field in options.
      const service = (options as {service?: string}).service
      if (service === 'platform') platformConstructorSpy(options)
      else if (service === 'data') dataConstructorSpy(options)
    }
  },
}))

vi.mock('@heroku/types/3.sdk/routes', () => ({
  app: {
    update: {hasRequestBody: true, method: 'PATCH', path: '/apps/{appIdentity}'},
  },
}))

vi.mock('@heroku/types/data/routes', () => ({
  database: {
    info: {method: 'GET', path: '/databases/{databaseIdentity}'},
  },
}))

describe('HerokuSDK', () => {
  afterEach(() => {
    platformConstructorSpy.mockClear()
    dataConstructorSpy.mockClear()
    vi.resetModules()
  })

  it('constructs no service clients eagerly', async () => {
    const {HerokuSDK} = await import('./heroku-sdk.js')

    new HerokuSDK()

    expect(platformConstructorSpy).not.toHaveBeenCalled()
    expect(dataConstructorSpy).not.toHaveBeenCalled()
  })

  it('lazily constructs the platform client on first access', async () => {
    const {HerokuSDK} = await import('./heroku-sdk.js')
    const sdk = new HerokuSDK({clientOptions: {token: 'abc'}})

    void sdk.platform

    expect(platformConstructorSpy).toHaveBeenCalledTimes(1)
    expect(platformConstructorSpy).toHaveBeenCalledWith(expect.objectContaining({
      service: 'platform',
      token: 'abc',
    }))
    expect(dataConstructorSpy).not.toHaveBeenCalled()
  })

  it('memoizes service clients across repeated access', async () => {
    const {HerokuSDK} = await import('./heroku-sdk.js')
    const sdk = new HerokuSDK()

    const a = sdk.platform
    const b = sdk.platform

    expect(a).toBe(b)
    expect(platformConstructorSpy).toHaveBeenCalledTimes(1)
  })

  it('routes extension methods through the merged proxy', async () => {
    const {HerokuSDK} = await import('./heroku-sdk.js')
    const {extendResource} = await import('./extend-resource.js')

    const ext = extendResource('platform', 'app', () => ({
      enableMaintenance: () => 'maintenance-on',
    }))

    const sdk = new HerokuSDK({extensions: [ext]})

    // Cast to bypass overly-narrow inferred types for the test.
    const result = (sdk.platform.app as unknown as {enableMaintenance: () => string}).enableMaintenance()
    expect(result).toBe('maintenance-on')
  })

  it('partitions extensions by service so platform extensions do not leak into data', async () => {
    const {HerokuSDK} = await import('./heroku-sdk.js')
    const {extendResource} = await import('./extend-resource.js')

    const platformExt = extendResource('platform', 'app', () => ({onlyPlatform: () => 'p'}))
    const dataExt = extendResource('data', 'database', () => ({onlyData: () => 'd'}))

    const sdk = new HerokuSDK({extensions: [platformExt, dataExt]})

    expect((sdk.platform.app as unknown as {onlyPlatform: () => string}).onlyPlatform()).toBe('p')
    expect((sdk.data.database as unknown as {onlyData: () => string}).onlyData()).toBe('d')
    // Platform extension does not appear on data.app, and data extension does not appear on platform.database.
    expect((sdk.data as unknown as {app?: unknown}).app).toBeUndefined()
    expect((sdk.platform as unknown as {database?: unknown}).database).toBeUndefined()
  })
})
```

- [ ] **Step 3.2: Run the test to confirm it fails**

Run: `npm test -- src/core/heroku-sdk.test.ts`
Expected: FAIL — current `heroku-sdk.ts` doesn't export `HerokuSDK` with a constructor accepting `{extensions, clientOptions}`.

- [ ] **Step 3.3: Replace `src/core/heroku-sdk.ts`**

Replace the entire contents of `src/core/heroku-sdk.ts` with:

```ts
import type {HerokuApiClientOptions} from '@heroku/api-client'

import type {DataClient} from '../services/data.js'
import type {PlatformClient} from '../services/platform.js'

import {createDataClient} from '../services/data.js'
import {createPlatformClient} from '../services/platform.js'

import type {
  ApplyExtensions,
  ExtensionsFor,
  ResourceCtx,
  ResourceExtension,
  ServiceName,
} from './extend-resource.js'

import {mergeExtensions} from './extensions-proxy.js'

export type HerokuSDKOptions<Exts extends readonly ResourceExtension[]> = {
  clientOptions?: HerokuApiClientOptions
  extensions?: Exts
}

export class HerokuSDK<
  const Exts extends readonly ResourceExtension[] = readonly ResourceExtension[],
> {
  readonly #clientOptions: HerokuApiClientOptions
  readonly #extensionsByService: Map<ServiceName, ResourceExtension[]>

  #ctx: ResourceCtx | undefined
  #data: unknown
  #platform: unknown
  #rawData: DataClient | undefined
  #rawPlatform: PlatformClient | undefined

  constructor(options: HerokuSDKOptions<Exts> = {}) {
    this.#clientOptions = options.clientOptions ?? {}
    this.#extensionsByService = partitionByService(options.extensions ?? [])
  }

  get data(): ApplyExtensions<DataClient, ExtensionsFor<Exts, 'data'>> {
    if (!this.#data) {
      this.#data = mergeExtensions(
        this.#getRawData(),
        this.#extensionsByService.get('data') ?? [],
        this.#getCtx(),
      )
    }

    return this.#data as ApplyExtensions<DataClient, ExtensionsFor<Exts, 'data'>>
  }

  get platform(): ApplyExtensions<PlatformClient, ExtensionsFor<Exts, 'platform'>> {
    if (!this.#platform) {
      this.#platform = mergeExtensions(
        this.#getRawPlatform(),
        this.#extensionsByService.get('platform') ?? [],
        this.#getCtx(),
      )
    }

    return this.#platform as ApplyExtensions<PlatformClient, ExtensionsFor<Exts, 'platform'>>
  }

  #getCtx(): ResourceCtx {
    this.#ctx ??= {
      data: this.#getRawData(),
      platform: this.#getRawPlatform(),
    }

    return this.#ctx
  }

  #getRawData(): DataClient {
    this.#rawData ??= createDataClient(this.#clientOptions)
    return this.#rawData
  }

  #getRawPlatform(): PlatformClient {
    this.#rawPlatform ??= createPlatformClient(this.#clientOptions)
    return this.#rawPlatform
  }
}

function partitionByService(
  extensions: readonly ResourceExtension[],
): Map<ServiceName, ResourceExtension[]> {
  const map = new Map<ServiceName, ResourceExtension[]>()
  for (const ext of extensions) {
    const list = map.get(ext.service) ?? []
    list.push(ext)
    map.set(ext.service, list)
  }

  return map
}
```

- [ ] **Step 3.4: Run the test to confirm it passes**

Run: `npm test -- src/core/heroku-sdk.test.ts`
Expected: PASS — all five tests green.

- [ ] **Step 3.5: Run the full test suite to confirm nothing else broke**

Run: `npm test`
Expected: PASS — all existing tests still green.

- [ ] **Step 3.6: Run the build to confirm types compile**

Run: `npm run build`
Expected: SUCCESS — `dist/` is produced with no type errors.

- [ ] **Step 3.7: Commit**

```bash
git add src/core/heroku-sdk.ts src/core/heroku-sdk.test.ts
git commit -m "feat(core): implement HerokuSDK class with extension-merged service views"
```

---

### Task 4: Update `package.json` exports and `sideEffects`

**Files:**
- Modify: `package.json`

- [ ] **Step 4.1: Open `package.json` and replace the `exports` and add `sideEffects`**

Current `exports` block (lines 8–13):

```json
"exports": {
  ".": "./dist/index.js",
  "./platform": "./dist/services/platform.js",
  "./data": "./dist/services/data.js",
  "./compositions/*": "./dist/compositions/*.js"
},
```

Replace with:

```json
"exports": {
  ".": "./dist/index.js",
  "./platform": "./dist/services/platform.js",
  "./data": "./dist/services/data.js",
  "./sdk": "./dist/core/heroku-sdk.js",
  "./extensions/platform": "./dist/resources/extensions/platform.js",
  "./extensions/data": "./dist/resources/extensions/data.js",
  "./resources/*": "./dist/resources/*.js",
  "./compositions/*": "./dist/compositions/*.js"
},
"sideEffects": false,
```

Place `"sideEffects": false,` immediately after the closing brace of `"exports"`.

- [ ] **Step 4.2: Run the build to confirm the manifest is valid**

Run: `npm run build`
Expected: SUCCESS — TypeScript still compiles. (Note: the new subpath targets won't exist on disk yet, but `tsc` doesn't validate the exports map, so this just confirms nothing else regressed.)

- [ ] **Step 4.3: Run the full test suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 4.4: Commit**

```bash
git add package.json
git commit -m "build(pkg): add /sdk, /extensions/*, /resources/* subpath exports; sideEffects: false"
```

---

# Phase 2 — Migrate `app` (canary) (Step 2 from the spec)

This phase proves the architecture against the simplest existing composition.

---

### Task 5: Create the `app` resource module and tests

**Files:**
- Create: `src/resources/platform/app.ts`
- Create: `src/resources/platform/app.test.ts`

- [ ] **Step 5.1: Write the failing test for the named functions**

Create `src/resources/platform/app.test.ts`:

```ts
import type {App} from '@heroku/types/3.sdk'

import {describe, expect, it, vi} from 'vitest'

import type {ResourceCtx} from '../../core/extend-resource.js'

import {appExtensions, disableMaintenance, enableMaintenance} from './app.js'

function ctxWithAppUpdate(update: ReturnType<typeof vi.fn>): ResourceCtx {
  return {
    data: {} as never,
    platform: {app: {update}} as never,
  }
}

describe('enableMaintenance', () => {
  it('calls platform.app.update with maintenance: true', async () => {
    const update = vi.fn().mockResolvedValue({maintenance: true, name: 'app-1'} as App)

    const result = await enableMaintenance(ctxWithAppUpdate(update), 'app-1')

    expect(update).toHaveBeenCalledWith('app-1', {maintenance: true})
    expect(result).toEqual({maintenance: true, name: 'app-1'})
  })

  it('throws if the abort signal is already aborted', async () => {
    const update = vi.fn()
    const controller = new AbortController()
    controller.abort()

    await expect(
      enableMaintenance(ctxWithAppUpdate(update), 'app-1', {signal: controller.signal}),
    ).rejects.toThrow()
    expect(update).not.toHaveBeenCalled()
  })
})

describe('disableMaintenance', () => {
  it('calls platform.app.update with maintenance: false', async () => {
    const update = vi.fn().mockResolvedValue({maintenance: false, name: 'app-1'} as App)

    const result = await disableMaintenance(ctxWithAppUpdate(update), 'app-1')

    expect(update).toHaveBeenCalledWith('app-1', {maintenance: false})
    expect(result).toEqual({maintenance: false, name: 'app-1'})
  })
})

describe('appExtensions', () => {
  it('declares service: platform, resource: app', () => {
    expect(appExtensions.service).toBe('platform')
    expect(appExtensions.resource).toBe('app')
  })

  it('factory returns enableMaintenance and disableMaintenance methods', () => {
    const update = vi.fn()
    const methods = appExtensions.factory(ctxWithAppUpdate(update))
    expect(typeof methods.enableMaintenance).toBe('function')
    expect(typeof methods.disableMaintenance).toBe('function')
  })

  it('factory enableMaintenance delegates to the named function', async () => {
    const update = vi.fn().mockResolvedValue({} as App)
    const methods = appExtensions.factory(ctxWithAppUpdate(update))

    await methods.enableMaintenance('app-1')

    expect(update).toHaveBeenCalledWith('app-1', {maintenance: true})
  })
})
```

- [ ] **Step 5.2: Run the test to confirm it fails**

Run: `npm test -- src/resources/platform/app.test.ts`
Expected: FAIL — `Cannot find module './app.js'`.

- [ ] **Step 5.3: Implement the resource module**

Create `src/resources/platform/app.ts`:

```ts
import type {App} from '@heroku/types/3.sdk'

import {extendResource} from '../../core/extend-resource.js'
import type {ResourceCtx} from '../../core/extend-resource.js'

export type AppMaintenanceOptions = {
  signal?: AbortSignal
}

export async function enableMaintenance(
  ctx: ResourceCtx,
  appIdentity: string,
  options: AppMaintenanceOptions = {},
): Promise<App> {
  options.signal?.throwIfAborted()
  return ctx.platform.app.update(appIdentity, {maintenance: true})
}

export async function disableMaintenance(
  ctx: ResourceCtx,
  appIdentity: string,
  options: AppMaintenanceOptions = {},
): Promise<App> {
  options.signal?.throwIfAborted()
  return ctx.platform.app.update(appIdentity, {maintenance: false})
}

export const appExtensions = extendResource('platform', 'app', (ctx) => ({
  disableMaintenance: (appIdentity: string, options?: AppMaintenanceOptions) =>
    disableMaintenance(ctx, appIdentity, options),
  enableMaintenance: (appIdentity: string, options?: AppMaintenanceOptions) =>
    enableMaintenance(ctx, appIdentity, options),
}))
```

- [ ] **Step 5.4: Run the test to confirm it passes**

Run: `npm test -- src/resources/platform/app.test.ts`
Expected: PASS — all five tests green.

- [ ] **Step 5.5: Commit**

```bash
git add src/resources/platform/app.ts src/resources/platform/app.test.ts
git commit -m "feat(resources): add platform/app resource with enableMaintenance/disableMaintenance"
```

---

### Task 6: Create the platform extensions barrel and convert the `app` composition to a transitional alias

**Files:**
- Create: `src/resources/extensions/platform.ts`
- Modify: `src/compositions/app.ts` (full rewrite)

- [ ] **Step 6.1: Create the barrel**

Create `src/resources/extensions/platform.ts`:

```ts
export {appExtensions} from '../platform/app.js'
```

(Other resources will be added to this file in later tasks.)

- [ ] **Step 6.2: Rewrite `src/compositions/app.ts` as a transitional alias**

Replace the entire contents of `src/compositions/app.ts` with:

```ts
import type {HerokuApiClientOptions} from '@heroku/api-client'
import type {App} from '@heroku/types/3.sdk'

import type {ResourceCtx} from '../core/extend-resource.js'

import {createDataClient} from '../services/data.js'
import {createPlatformClient} from '../services/platform.js'

import * as appResource from '../resources/platform/app.js'

export type AppOptions = {
  clientOptions?: HerokuApiClientOptions
  signal?: AbortSignal
}

function makeCtx(options: AppOptions): ResourceCtx {
  let platform: ReturnType<typeof createPlatformClient> | undefined
  let data: ReturnType<typeof createDataClient> | undefined
  return {
    get data() {
      data ??= createDataClient(options.clientOptions)
      return data
    },
    get platform() {
      platform ??= createPlatformClient(options.clientOptions)
      return platform
    },
  }
}

export async function enableMaintenanceMode(
  appIdentity: string,
  options: AppOptions = {},
): Promise<App> {
  return appResource.enableMaintenance(makeCtx(options), appIdentity, {signal: options.signal})
}

export async function disableMaintenanceMode(
  appIdentity: string,
  options: AppOptions = {},
): Promise<App> {
  return appResource.disableMaintenance(makeCtx(options), appIdentity, {signal: options.signal})
}
```

The lazy `makeCtx` getters are required so the existing test (`expect(createPlatformClient).not.toHaveBeenCalled()` after an aborted signal) keeps passing.

- [ ] **Step 6.3: Run the existing composition test to confirm behavior is preserved**

Run: `npm test -- src/compositions/app.test.ts`
Expected: PASS — same behavior as before, all four tests green.

- [ ] **Step 6.4: Run the full test suite**

Run: `npm test`
Expected: PASS — all tests green.

- [ ] **Step 6.5: Run the build to confirm types compile**

Run: `npm run build`
Expected: SUCCESS.

- [ ] **Step 6.6: Commit**

```bash
git add src/resources/extensions/platform.ts src/compositions/app.ts
git commit -m "refactor(compositions): route app composition through resources/platform/app"
```

---

# Phase 3 — Migrate single-service compositions: `dyno` and `pipeline-promotion` (Step 3 from the spec)

---

### Task 7: Create the `dyno` resource module and tests

**Files:**
- Create: `src/resources/platform/dyno.ts`
- Create: `src/resources/platform/dyno.test.ts`

- [ ] **Step 7.1: Write the failing test**

Create `src/resources/platform/dyno.test.ts`:

```ts
import type {Formation} from '@heroku/types/3.sdk'

import {describe, expect, it, vi} from 'vitest'

import type {ResourceCtx} from '../../core/extend-resource.js'

import {dynoExtensions, restartDynos, scaleDynos} from './dyno.js'

function platformCtx(platform: Record<string, unknown>): ResourceCtx {
  return {data: {} as never, platform: platform as never}
}

describe('scaleDynos', () => {
  it('routes a single update object to formation.update', async () => {
    const formation = {quantity: 3, type: 'web'} as Formation
    const update = vi.fn().mockResolvedValue(formation)
    const batchUpdate = vi.fn()
    const ctx = platformCtx({formation: {batchUpdate, update}})

    const result = await scaleDynos(ctx, 'app-1', {quantity: 3, type: 'web'})

    expect(update).toHaveBeenCalledWith('app-1', 'web', {quantity: 3})
    expect(batchUpdate).not.toHaveBeenCalled()
    expect(result).toBe(formation)
  })

  it('routes an updates array to formation.batchUpdate', async () => {
    const formations = [{quantity: 2, type: 'web'} as Formation]
    const update = vi.fn()
    const batchUpdate = vi.fn().mockResolvedValue(formations)
    const ctx = platformCtx({formation: {batchUpdate, update}})

    const updates = [{quantity: 2, type: 'web'}]
    const result = await scaleDynos(ctx, 'app-1', updates)

    expect(batchUpdate).toHaveBeenCalledWith('app-1', {updates})
    expect(update).not.toHaveBeenCalled()
    expect(result).toBe(formations)
  })

  it('throws if the signal is already aborted', async () => {
    const update = vi.fn()
    const ctx = platformCtx({formation: {update}})
    const controller = new AbortController()
    controller.abort()

    await expect(
      scaleDynos(ctx, 'app-1', {quantity: 1, type: 'web'}, {signal: controller.signal}),
    ).rejects.toThrow()
    expect(update).not.toHaveBeenCalled()
  })
})

describe('restartDynos', () => {
  it('restarts all dynos when no target is provided', async () => {
    const restartAll = vi.fn()
    const restart = vi.fn()
    const restartFormation = vi.fn()
    const ctx = platformCtx({dyno: {restart, restartAll, restartFormation}})

    await restartDynos(ctx, 'app-1')

    expect(restartAll).toHaveBeenCalledWith('app-1')
    expect(restart).not.toHaveBeenCalled()
    expect(restartFormation).not.toHaveBeenCalled()
  })

  it('restarts a formation when target is a process type', async () => {
    const restartAll = vi.fn()
    const restart = vi.fn()
    const restartFormation = vi.fn()
    const ctx = platformCtx({dyno: {restart, restartAll, restartFormation}})

    await restartDynos(ctx, 'app-1', {type: 'web'})

    expect(restartFormation).toHaveBeenCalledWith('app-1', 'web')
  })

  it('restarts a specific dyno when target is a dyno name', async () => {
    const restartAll = vi.fn()
    const restart = vi.fn()
    const restartFormation = vi.fn()
    const ctx = platformCtx({dyno: {restart, restartAll, restartFormation}})

    await restartDynos(ctx, 'app-1', {dyno: 'web.1'})

    expect(restart).toHaveBeenCalledWith('app-1', 'web.1')
  })
})

describe('dynoExtensions', () => {
  it('declares service: platform, resource: dyno', () => {
    expect(dynoExtensions.service).toBe('platform')
    expect(dynoExtensions.resource).toBe('dyno')
  })

  it('factory exposes scale and restart methods', () => {
    const ctx = platformCtx({dyno: {}, formation: {}})
    const methods = dynoExtensions.factory(ctx)
    expect(typeof methods.scale).toBe('function')
    expect(typeof methods.restart).toBe('function')
  })
})
```

- [ ] **Step 7.2: Run the test to confirm it fails**

Run: `npm test -- src/resources/platform/dyno.test.ts`
Expected: FAIL — `Cannot find module './dyno.js'`.

- [ ] **Step 7.3: Implement the resource module**

Create `src/resources/platform/dyno.ts`:

```ts
import type {
  Formation,
  FormationBatchUpdateOpts,
  FormationUpdateOpts,
} from '@heroku/types/3.sdk'

import {extendResource} from '../../core/extend-resource.js'
import type {ResourceCtx} from '../../core/extend-resource.js'

export type DynoOptions = {
  signal?: AbortSignal
}

export type ScaleDynosUpdate = FormationUpdateOpts & {
  type: string
}

export type RestartDynosTarget =
  | {dyno: string}
  | {type: string}

export function scaleDynos(
  ctx: ResourceCtx,
  appIdentity: string,
  updates: ScaleDynosUpdate,
  options?: DynoOptions,
): Promise<Formation>
export function scaleDynos(
  ctx: ResourceCtx,
  appIdentity: string,
  updates: FormationBatchUpdateOpts['updates'],
  options?: DynoOptions,
): Promise<Formation[]>
export async function scaleDynos(
  ctx: ResourceCtx,
  appIdentity: string,
  updates: FormationBatchUpdateOpts['updates'] | ScaleDynosUpdate,
  options: DynoOptions = {},
): Promise<Formation | Formation[]> {
  options.signal?.throwIfAborted()

  if (Array.isArray(updates)) {
    return ctx.platform.formation.batchUpdate(appIdentity, {updates})
  }

  const {type, ...body} = updates
  return ctx.platform.formation.update(appIdentity, type, body)
}

export async function restartDynos(
  ctx: ResourceCtx,
  appIdentity: string,
  target?: RestartDynosTarget,
  options: DynoOptions = {},
): Promise<void> {
  options.signal?.throwIfAborted()

  if (!target) {
    await ctx.platform.dyno.restartAll(appIdentity)
    return
  }

  if ('dyno' in target) {
    await ctx.platform.dyno.restart(appIdentity, target.dyno)
    return
  }

  await ctx.platform.dyno.restartFormation(appIdentity, target.type)
}

export const dynoExtensions = extendResource('platform', 'dyno', (ctx) => ({
  restart: (appIdentity: string, target?: RestartDynosTarget, options?: DynoOptions) =>
    restartDynos(ctx, appIdentity, target, options),
  scale: ((appIdentity: string, updates: never, options?: DynoOptions) =>
    scaleDynos(ctx, appIdentity, updates, options)) as {
    (appIdentity: string, updates: ScaleDynosUpdate, options?: DynoOptions): Promise<Formation>;
    (
      appIdentity: string,
      updates: FormationBatchUpdateOpts['updates'],
      options?: DynoOptions
    ): Promise<Formation[]>;
  },
}))
```

The `scale`/`restart` extension keys are method names on the `dyno` resource. The cast on `scale` preserves the overload signatures through the extension layer.

- [ ] **Step 7.4: Run the test to confirm it passes**

Run: `npm test -- src/resources/platform/dyno.test.ts`
Expected: PASS — all six tests green.

- [ ] **Step 7.5: Commit**

```bash
git add src/resources/platform/dyno.ts src/resources/platform/dyno.test.ts
git commit -m "feat(resources): add platform/dyno resource with scale and restart"
```

---

### Task 8: Update barrel and convert the `dyno` composition to a transitional alias

**Files:**
- Modify: `src/resources/extensions/platform.ts`
- Modify: `src/compositions/dyno.ts` (full rewrite)

- [ ] **Step 8.1: Add `dynoExtensions` to the barrel**

Replace `src/resources/extensions/platform.ts` with:

```ts
export {appExtensions} from '../platform/app.js'
export {dynoExtensions} from '../platform/dyno.js'
```

- [ ] **Step 8.2: Rewrite `src/compositions/dyno.ts`**

Replace the entire contents of `src/compositions/dyno.ts` with:

```ts
import type {HerokuApiClientOptions} from '@heroku/api-client'
import type {Formation, FormationBatchUpdateOpts} from '@heroku/types/3.sdk'

import type {ResourceCtx} from '../core/extend-resource.js'

import {createDataClient} from '../services/data.js'
import {createPlatformClient} from '../services/platform.js'

import * as dynoResource from '../resources/platform/dyno.js'

export type DynoOptions = {
  clientOptions?: HerokuApiClientOptions
  signal?: AbortSignal
}

export type ScaleDynosUpdate = dynoResource.ScaleDynosUpdate
export type RestartDynosTarget = dynoResource.RestartDynosTarget

function makeCtx(options: DynoOptions): ResourceCtx {
  let platform: ReturnType<typeof createPlatformClient> | undefined
  let data: ReturnType<typeof createDataClient> | undefined
  return {
    get data() {
      data ??= createDataClient(options.clientOptions)
      return data
    },
    get platform() {
      platform ??= createPlatformClient(options.clientOptions)
      return platform
    },
  }
}

export function scaleDynos(
  appIdentity: string,
  updates: ScaleDynosUpdate,
  options?: DynoOptions,
): Promise<Formation>
export function scaleDynos(
  appIdentity: string,
  updates: FormationBatchUpdateOpts['updates'],
  options?: DynoOptions,
): Promise<Formation[]>
export async function scaleDynos(
  appIdentity: string,
  updates: FormationBatchUpdateOpts['updates'] | ScaleDynosUpdate,
  options: DynoOptions = {},
): Promise<Formation | Formation[]> {
  if (Array.isArray(updates)) {
    return dynoResource.scaleDynos(makeCtx(options), appIdentity, updates, {signal: options.signal})
  }

  return dynoResource.scaleDynos(makeCtx(options), appIdentity, updates, {signal: options.signal})
}

export async function restartDynos(
  appIdentity: string,
  target?: RestartDynosTarget,
  options: DynoOptions = {},
): Promise<void> {
  await dynoResource.restartDynos(makeCtx(options), appIdentity, target, {signal: options.signal})
}
```

- [ ] **Step 8.3: Run the existing composition test**

Run: `npm test -- src/compositions/dyno.test.ts`
Expected: PASS — all eight tests green.

- [ ] **Step 8.4: Run the full test suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 8.5: Commit**

```bash
git add src/resources/extensions/platform.ts src/compositions/dyno.ts
git commit -m "refactor(compositions): route dyno composition through resources/platform/dyno"
```

---

### Task 9: Create the `pipeline-promotion` resource module and tests

**Files:**
- Create: `src/resources/platform/pipeline-promotion.ts`
- Create: `src/resources/platform/pipeline-promotion.test.ts`

- [ ] **Step 9.1: Write the failing test**

Create `src/resources/platform/pipeline-promotion.test.ts`:

```ts
import type {
  PipelinePromotion,
  PipelinePromotionCreateOpts,
  PipelinePromotionTarget,
} from '@heroku/types/3.sdk'

import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'

import type {ResourceCtx} from '../../core/extend-resource.js'

import {pipelinePromotionExtensions, promotePipeline} from './pipeline-promotion.js'

const createBody: PipelinePromotionCreateOpts = {
  pipeline: {id: 'pipeline-1'},
  source: {app: {id: 'source-app'}},
  targets: [{app: {id: 'target-1'}}],
}

function ctxFor(promotion: PipelinePromotion, listResults: PipelinePromotionTarget[][]): {
  ctx: ResourceCtx;
  create: ReturnType<typeof vi.fn>;
  list: ReturnType<typeof vi.fn>;
} {
  const create = vi.fn().mockResolvedValue(promotion)
  const list = vi.fn()
  for (const result of listResults) list.mockResolvedValueOnce(result)

  return {
    create,
    ctx: {
      data: {} as never,
      platform: {
        pipelinePromotion: {create},
        pipelinePromotionTarget: {list},
      } as never,
    },
    list,
  }
}

describe('promotePipeline', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  it('returns immediately when all targets are terminal on first poll', async () => {
    const promotion = {id: 'promo-1'} as PipelinePromotion
    const targets: PipelinePromotionTarget[] = [
      {id: 't1', status: 'succeeded'},
    ]
    const {ctx, create} = ctxFor(promotion, [targets])

    const result = await promotePipeline(ctx, createBody)

    expect(create).toHaveBeenCalledWith(createBody)
    expect(result).toEqual({promotion, targets})
  })

  it('polls until every target reaches a terminal status', async () => {
    const promotion = {id: 'promo-2'} as PipelinePromotion
    const pending: PipelinePromotionTarget[] = [{id: 't1', status: 'pending'}]
    const done: PipelinePromotionTarget[] = [{id: 't1', status: 'succeeded'}]
    const {ctx, list} = ctxFor(promotion, [pending, done])

    const promise = promotePipeline(ctx, createBody, {intervalMs: 500})
    await vi.advanceTimersByTimeAsync(1000)
    const result = await promise

    expect(list).toHaveBeenCalledTimes(2)
    expect(result.targets).toEqual(done)
  })

  it('throws if the create response is missing an id', async () => {
    const {ctx} = ctxFor({} as PipelinePromotion, [])

    await expect(promotePipeline(ctx, createBody)).rejects.toThrow(/did not include an id/)
  })

  it('throws when the timeout elapses before targets reach a terminal status', async () => {
    const promotion = {id: 'promo-3'} as PipelinePromotion
    const pending: PipelinePromotionTarget[] = [{id: 't1', status: 'pending'}]
    const list = vi.fn().mockResolvedValue(pending)
    const ctx: ResourceCtx = {
      data: {} as never,
      platform: {
        pipelinePromotion: {create: vi.fn().mockResolvedValue(promotion)},
        pipelinePromotionTarget: {list},
      } as never,
    }

    const promise = promotePipeline(ctx, createBody, {intervalMs: 100, timeoutMs: 250})
    const expectation = expect(promise).rejects.toThrow(/did not reach a terminal state within 250ms/)
    await vi.advanceTimersByTimeAsync(1000)
    await expectation
  })

  it('aborts polling when the abort signal fires', async () => {
    const promotion = {id: 'promo-4'} as PipelinePromotion
    const pending: PipelinePromotionTarget[] = [{id: 't1', status: 'pending'}]
    const list = vi.fn().mockResolvedValue(pending)
    const ctx: ResourceCtx = {
      data: {} as never,
      platform: {
        pipelinePromotion: {create: vi.fn().mockResolvedValue(promotion)},
        pipelinePromotionTarget: {list},
      } as never,
    }

    const controller = new AbortController()
    const promise = promotePipeline(ctx, createBody, {intervalMs: 1000, signal: controller.signal})
    const expectation = expect(promise).rejects.toThrow(/aborted/i)
    controller.abort()
    await vi.advanceTimersByTimeAsync(0)
    await expectation
  })
})

describe('pipelinePromotionExtensions', () => {
  it('declares service: platform, resource: pipelinePromotion', () => {
    expect(pipelinePromotionExtensions.service).toBe('platform')
    expect(pipelinePromotionExtensions.resource).toBe('pipelinePromotion')
  })

  it('factory exposes a promote method', () => {
    const ctx: ResourceCtx = {data: {} as never, platform: {} as never}
    const methods = pipelinePromotionExtensions.factory(ctx)
    expect(typeof methods.promote).toBe('function')
  })
})
```

- [ ] **Step 9.2: Run the test to confirm it fails**

Run: `npm test -- src/resources/platform/pipeline-promotion.test.ts`
Expected: FAIL — `Cannot find module './pipeline-promotion.js'`.

- [ ] **Step 9.3: Implement the resource module**

Create `src/resources/platform/pipeline-promotion.ts`:

```ts
import type {
  PipelinePromotion,
  PipelinePromotionCreateOpts,
  PipelinePromotionTarget,
} from '@heroku/types/3.sdk'

import {extendResource} from '../../core/extend-resource.js'
import type {ResourceCtx} from '../../core/extend-resource.js'

export type PromotePipelineOptions = {
  intervalMs?: number
  signal?: AbortSignal
  timeoutMs?: number
}

export type PromotePipelineResult = {
  promotion: PipelinePromotion
  targets: PipelinePromotionTarget[]
}

const DEFAULT_INTERVAL_MS = 1000

export async function promotePipeline(
  ctx: ResourceCtx,
  body: PipelinePromotionCreateOpts,
  options: PromotePipelineOptions = {},
): Promise<PromotePipelineResult> {
  const {intervalMs = DEFAULT_INTERVAL_MS, signal, timeoutMs} = options

  const promotion = await ctx.platform.pipelinePromotion.create(body)
  if (!promotion.id) {
    throw new Error('Pipeline promotion response did not include an id')
  }

  const deadline = timeoutMs === undefined ? undefined : Date.now() + timeoutMs

  while (true) {
    signal?.throwIfAborted()

    // eslint-disable-next-line no-await-in-loop
    const targets = await ctx.platform.pipelinePromotionTarget.list(promotion.id)
    if (targets.every((target) => target.status !== 'pending')) {
      return {promotion, targets}
    }

    if (deadline !== undefined && Date.now() >= deadline) {
      throw new Error(
        `Pipeline promotion ${promotion.id} did not reach a terminal state within ${timeoutMs}ms`,
      )
    }

    // eslint-disable-next-line no-await-in-loop
    await wait(intervalMs, signal)
  }
}

export const pipelinePromotionExtensions = extendResource('platform', 'pipelinePromotion', (ctx) => ({
  promote: (body: PipelinePromotionCreateOpts, options?: PromotePipelineOptions) =>
    promotePipeline(ctx, body, options),
}))

function wait(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    function onAbort() {
      clearTimeout(timer)
      reject(signal!.reason ?? new Error('Aborted'))
    }

    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)

    if (signal) {
      if (signal.aborted) {
        clearTimeout(timer)
        reject(signal.reason ?? new Error('Aborted'))
        return
      }

      signal.addEventListener('abort', onAbort, {once: true})
    }
  })
}
```

- [ ] **Step 9.4: Run the test to confirm it passes**

Run: `npm test -- src/resources/platform/pipeline-promotion.test.ts`
Expected: PASS — all seven tests green.

- [ ] **Step 9.5: Commit**

```bash
git add src/resources/platform/pipeline-promotion.ts src/resources/platform/pipeline-promotion.test.ts
git commit -m "feat(resources): add platform/pipeline-promotion resource with promote"
```

---

### Task 10: Update barrel and convert the `pipeline` composition to a transitional alias

**Files:**
- Modify: `src/resources/extensions/platform.ts`
- Modify: `src/compositions/pipeline.ts` (full rewrite)

- [ ] **Step 10.1: Add `pipelinePromotionExtensions` to the barrel**

Replace `src/resources/extensions/platform.ts` with:

```ts
export {appExtensions} from '../platform/app.js'
export {dynoExtensions} from '../platform/dyno.js'
export {pipelinePromotionExtensions} from '../platform/pipeline-promotion.js'
```

- [ ] **Step 10.2: Rewrite `src/compositions/pipeline.ts`**

Replace the entire contents of `src/compositions/pipeline.ts` with:

```ts
import type {HerokuApiClientOptions} from '@heroku/api-client'
import type {PipelinePromotionCreateOpts} from '@heroku/types/3.sdk'

import type {ResourceCtx} from '../core/extend-resource.js'

import {createDataClient} from '../services/data.js'
import {createPlatformClient} from '../services/platform.js'

import * as pipelinePromotionResource from '../resources/platform/pipeline-promotion.js'

export type PromotePipelineOptions = {
  clientOptions?: HerokuApiClientOptions
  intervalMs?: number
  signal?: AbortSignal
  timeoutMs?: number
}

export type PromotePipelineResult = pipelinePromotionResource.PromotePipelineResult

function makeCtx(options: PromotePipelineOptions): ResourceCtx {
  let platform: ReturnType<typeof createPlatformClient> | undefined
  let data: ReturnType<typeof createDataClient> | undefined
  return {
    get data() {
      data ??= createDataClient(options.clientOptions)
      return data
    },
    get platform() {
      platform ??= createPlatformClient(options.clientOptions)
      return platform
    },
  }
}

export async function promotePipeline(
  body: PipelinePromotionCreateOpts,
  options: PromotePipelineOptions = {},
): Promise<PromotePipelineResult> {
  return pipelinePromotionResource.promotePipeline(makeCtx(options), body, {
    intervalMs: options.intervalMs,
    signal: options.signal,
    timeoutMs: options.timeoutMs,
  })
}
```

- [ ] **Step 10.3: Run the existing composition test**

Run: `npm test -- src/compositions/pipeline.test.ts`
Expected: PASS — all seven tests green.

- [ ] **Step 10.4: Run the full test suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 10.5: Commit**

```bash
git add src/resources/extensions/platform.ts src/compositions/pipeline.ts
git commit -m "refactor(compositions): route pipeline composition through resources/platform/pipeline-promotion"
```

---

# Phase 4 — Migrate cross-service `pg` (Step 4 from the spec)

This phase is the first to exercise cross-service `ctx`. The existing `compositions/pg.ts` fans out across multiple Heroku data resources (`database`, `postgresDatabase`, `maintenance`, `transfer`); we mirror that fan-out at the resource level.

---

### Task 11: Add the shared `resolveAddonId` helper

**Files:**
- Create: `src/resources/data/internal/resolve-addon-id.ts`
- Create: `src/resources/data/internal/resolve-addon-id.test.ts`

- [ ] **Step 11.1: Write the failing test**

Create `src/resources/data/internal/resolve-addon-id.test.ts`:

```ts
import type {AddOnAttachment} from '@heroku/types/3.sdk'

import {describe, expect, it, vi} from 'vitest'

import type {PlatformClient} from '../../../services/platform.js'

import {resolveAddonId} from './resolve-addon-id.js'

function platform(matches: AddOnAttachment[]): PlatformClient {
  return {
    addOnAttachment: {
      resolution: vi.fn().mockResolvedValue(matches),
    },
  } as never
}

describe('resolveAddonId', () => {
  it('returns the addon id from the first matching attachment', async () => {
    const matches: AddOnAttachment[] = [
      {addon: {id: 'addon-1'}},
    ] as AddOnAttachment[]

    const id = await resolveAddonId(platform(matches), 'app-1', 'HEROKU_POSTGRESQL_BLUE')

    expect(id).toBe('addon-1')
  })

  it('defaults the addon identifier to DATABASE_URL when omitted', async () => {
    const resolution = vi.fn().mockResolvedValue([{addon: {id: 'addon-2'}}] as AddOnAttachment[])
    const client = {addOnAttachment: {resolution}} as never as PlatformClient

    await resolveAddonId(client, 'app-1')

    // eslint-disable-next-line camelcase
    expect(resolution).toHaveBeenCalledWith({addon_attachment: 'DATABASE_URL', app: 'app-1'})
  })

  it('throws when no attachment is found', async () => {
    await expect(resolveAddonId(platform([]), 'app-1', 'NOPE')).rejects.toThrow(/Could not resolve add-on/)
  })
})
```

- [ ] **Step 11.2: Run the test to confirm it fails**

Run: `npm test -- src/resources/data/internal/resolve-addon-id.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 11.3: Implement the helper**

Create `src/resources/data/internal/resolve-addon-id.ts`:

```ts
import type {AddOnAttachment} from '@heroku/types/3.sdk'

import type {PlatformClient} from '../../../services/platform.js'

export async function resolveAddonId(
  platform: PlatformClient,
  appIdentity: string,
  addonIdentity?: string,
): Promise<string> {
  const matches = await platform.addOnAttachment.resolution({
    // eslint-disable-next-line camelcase
    addon_attachment: addonIdentity ?? 'DATABASE_URL',
    app: appIdentity,
  })

  const attachment: AddOnAttachment | undefined = matches[0]
  const addonId = attachment?.addon?.id
  if (!addonId) {
    throw new Error(
      `Could not resolve add-on for ${appIdentity}${addonIdentity ? `::${addonIdentity}` : ''}`,
    )
  }

  return addonId
}
```

- [ ] **Step 11.4: Run the test to confirm it passes**

Run: `npm test -- src/resources/data/internal/resolve-addon-id.test.ts`
Expected: PASS.

- [ ] **Step 11.5: Commit**

```bash
git add src/resources/data/internal/resolve-addon-id.ts src/resources/data/internal/resolve-addon-id.test.ts
git commit -m "feat(resources): add internal resolveAddonId helper for data resources"
```

---

### Task 12: Create the `database` resource module

**Files:**
- Create: `src/resources/data/database.ts`
- Create: `src/resources/data/database.test.ts`

- [ ] **Step 12.1: Write the failing test**

Create `src/resources/data/database.test.ts`:

```ts
import type {AddOnAttachment} from '@heroku/types/3.sdk'

import {describe, expect, it, vi} from 'vitest'

import type {ResourceCtx} from '../../core/extend-resource.js'

import {databaseExtensions, describe_ as describeFn, prepareUpgrade, runUpgrade} from './database.js'

function buildCtx(opts: {
  databaseInfo?: ReturnType<typeof vi.fn>;
  prepareUpgrade?: ReturnType<typeof vi.fn>;
  resolution?: ReturnType<typeof vi.fn>;
  runUpgrade?: ReturnType<typeof vi.fn>;
}): ResourceCtx {
  return {
    data: {
      database: {
        info: opts.databaseInfo ?? vi.fn(),
        prepareUpgrade: opts.prepareUpgrade ?? vi.fn(),
        runUpgrade: opts.runUpgrade ?? vi.fn(),
      },
    } as never,
    platform: {
      addOnAttachment: {
        resolution: opts.resolution ?? vi.fn(),
      },
    } as never,
  }
}

const oneMatch = [{addon: {id: 'addon-1'}}] as AddOnAttachment[]

describe('describe', () => {
  it('resolves the addon and calls database.info', async () => {
    const resolution = vi.fn().mockResolvedValue(oneMatch)
    const databaseInfo = vi.fn().mockResolvedValue({plan: 'standard-0'})
    const ctx = buildCtx({databaseInfo, resolution})

    const result = await describeFn(ctx, 'app-1', 'HEROKU_POSTGRESQL_BLUE')

    // eslint-disable-next-line camelcase
    expect(resolution).toHaveBeenCalledWith({addon_attachment: 'HEROKU_POSTGRESQL_BLUE', app: 'app-1'})
    expect(databaseInfo).toHaveBeenCalledWith('addon-1')
    expect(result).toEqual({plan: 'standard-0'})
  })

  it('throws if signal is aborted', async () => {
    const ctx = buildCtx({})
    const controller = new AbortController()
    controller.abort()

    await expect(describeFn(ctx, 'app-1', undefined, {signal: controller.signal})).rejects.toThrow()
  })
})

describe('runUpgrade', () => {
  it('resolves the addon and calls database.runUpgrade with the body', async () => {
    const resolution = vi.fn().mockResolvedValue(oneMatch)
    const runUpgradeFn = vi.fn().mockResolvedValue({message: 'upgrading'})
    const ctx = buildCtx({resolution, runUpgrade: runUpgradeFn})

    const result = await runUpgrade(ctx, 'app-1', 'DATABASE_URL', {version: '17'})

    expect(runUpgradeFn).toHaveBeenCalledWith('addon-1', {version: '17'})
    expect(result).toEqual({message: 'upgrading'})
  })

  it('defaults to an empty body when none is provided', async () => {
    const resolution = vi.fn().mockResolvedValue(oneMatch)
    const runUpgradeFn = vi.fn().mockResolvedValue({})
    const ctx = buildCtx({resolution, runUpgrade: runUpgradeFn})

    await runUpgrade(ctx, 'app-1')

    expect(runUpgradeFn).toHaveBeenCalledWith('addon-1', {})
  })
})

describe('prepareUpgrade', () => {
  it('resolves the addon and calls database.prepareUpgrade', async () => {
    const resolution = vi.fn().mockResolvedValue(oneMatch)
    const prepareUpgradeFn = vi.fn().mockResolvedValue({message: 'scheduled'})
    const ctx = buildCtx({prepareUpgrade: prepareUpgradeFn, resolution})

    const result = await prepareUpgrade(ctx, 'app-1', 'DATABASE_URL', {version: '17'})

    expect(prepareUpgradeFn).toHaveBeenCalledWith('addon-1', {version: '17'})
    expect(result).toEqual({message: 'scheduled'})
  })
})

describe('databaseExtensions', () => {
  it('declares service: data, resource: database', () => {
    expect(databaseExtensions.service).toBe('data')
    expect(databaseExtensions.resource).toBe('database')
  })

  it('factory exposes describe, runUpgrade, prepareUpgrade', () => {
    const methods = databaseExtensions.factory(buildCtx({}))
    expect(typeof methods.describe).toBe('function')
    expect(typeof methods.runUpgrade).toBe('function')
    expect(typeof methods.prepareUpgrade).toBe('function')
  })
})
```

The named function is exported as `describe_` to avoid colliding with vitest's `describe` block in tests. The extension method exposes it as `describe`.

- [ ] **Step 12.2: Run the test to confirm it fails**

Run: `npm test -- src/resources/data/database.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 12.3: Implement the resource module**

Create `src/resources/data/database.ts`:

```ts
import type {
  DatabaseInfoResult,
  DatabasePrepareUpgradeResult,
  DatabaseRunUpgradeResult,
} from '@heroku/types/data'

import {extendResource} from '../../core/extend-resource.js'
import type {ResourceCtx} from '../../core/extend-resource.js'

import {resolveAddonId} from './internal/resolve-addon-id.js'

export type DatabaseOptions = {
  signal?: AbortSignal
}

export type DatabaseUpgradeBody = {
  version?: string
}

export async function describe_(
  ctx: ResourceCtx,
  appIdentity: string,
  addonIdentity?: string,
  options: DatabaseOptions = {},
): Promise<DatabaseInfoResult> {
  options.signal?.throwIfAborted()
  const addonId = await resolveAddonId(ctx.platform, appIdentity, addonIdentity)
  return ctx.data.database.info(addonId)
}

export async function runUpgrade(
  ctx: ResourceCtx,
  appIdentity: string,
  addonIdentity?: string,
  body: DatabaseUpgradeBody = {},
  options: DatabaseOptions = {},
): Promise<DatabaseRunUpgradeResult> {
  options.signal?.throwIfAborted()
  const addonId = await resolveAddonId(ctx.platform, appIdentity, addonIdentity)
  // Cast: routes.js declares hasRequestBody for runUpgrade but the generated
  // HerokuClient interface omits the body param (Shogun spec lacks a request schema).
  const fn = ctx.data.database.runUpgrade as
    (name: string, body: DatabaseUpgradeBody) => Promise<DatabaseRunUpgradeResult>
  return fn(addonId, body)
}

export async function prepareUpgrade(
  ctx: ResourceCtx,
  appIdentity: string,
  addonIdentity?: string,
  body: DatabaseUpgradeBody = {},
  options: DatabaseOptions = {},
): Promise<DatabasePrepareUpgradeResult> {
  options.signal?.throwIfAborted()
  const addonId = await resolveAddonId(ctx.platform, appIdentity, addonIdentity)
  // See note on runUpgrade.
  const fn = ctx.data.database.prepareUpgrade as
    (name: string, body: DatabaseUpgradeBody) => Promise<DatabasePrepareUpgradeResult>
  return fn(addonId, body)
}

export const databaseExtensions = extendResource('data', 'database', (ctx) => ({
  describe: (appIdentity: string, addonIdentity?: string, options?: DatabaseOptions) =>
    describe_(ctx, appIdentity, addonIdentity, options),
  prepareUpgrade: (
    appIdentity: string,
    addonIdentity?: string,
    body?: DatabaseUpgradeBody,
    options?: DatabaseOptions,
  ) => prepareUpgrade(ctx, appIdentity, addonIdentity, body, options),
  runUpgrade: (
    appIdentity: string,
    addonIdentity?: string,
    body?: DatabaseUpgradeBody,
    options?: DatabaseOptions,
  ) => runUpgrade(ctx, appIdentity, addonIdentity, body, options),
}))
```

- [ ] **Step 12.4: Run the test to confirm it passes**

Run: `npm test -- src/resources/data/database.test.ts`
Expected: PASS — all seven tests green.

- [ ] **Step 12.5: Commit**

```bash
git add src/resources/data/database.ts src/resources/data/database.test.ts
git commit -m "feat(resources): add data/database resource with describe/runUpgrade/prepareUpgrade"
```

---

### Task 13: Create the `postgres-database` and `maintenance` resource modules

**Files:**
- Create: `src/resources/data/postgres-database.ts`
- Create: `src/resources/data/postgres-database.test.ts`
- Create: `src/resources/data/maintenance.ts`
- Create: `src/resources/data/maintenance.test.ts`

- [ ] **Step 13.1: Write the failing test for `postgres-database`**

Create `src/resources/data/postgres-database.test.ts`:

```ts
import type {AddOnAttachment} from '@heroku/types/3.sdk'

import {describe, expect, it, vi} from 'vitest'

import type {ResourceCtx} from '../../core/extend-resource.js'

import {listCredentials, postgresDatabaseExtensions} from './postgres-database.js'

function buildCtx(resolution: ReturnType<typeof vi.fn>, list: ReturnType<typeof vi.fn>): ResourceCtx {
  return {
    data: {
      postgresDatabase: {listCredentials: list},
    } as never,
    platform: {
      addOnAttachment: {resolution},
    } as never,
  }
}

describe('listCredentials', () => {
  it('resolves the addon and calls postgresDatabase.listCredentials', async () => {
    const resolution = vi.fn().mockResolvedValue([{addon: {id: 'addon-x'}}] as AddOnAttachment[])
    const list = vi.fn().mockResolvedValue([{name: 'default', state: 'created'}])

    const result = await listCredentials(buildCtx(resolution, list), 'app-1', 'DATABASE_URL')

    expect(list).toHaveBeenCalledWith('addon-x')
    expect(result).toEqual([{name: 'default', state: 'created'}])
  })
})

describe('postgresDatabaseExtensions', () => {
  it('declares service: data, resource: postgresDatabase', () => {
    expect(postgresDatabaseExtensions.service).toBe('data')
    expect(postgresDatabaseExtensions.resource).toBe('postgresDatabase')
  })
})
```

- [ ] **Step 13.2: Run the test to confirm it fails**

Run: `npm test -- src/resources/data/postgres-database.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 13.3: Implement the resource**

Create `src/resources/data/postgres-database.ts`:

```ts
import type {PostgresDatabaseListCredentialsResult} from '@heroku/types/data'

import {extendResource} from '../../core/extend-resource.js'
import type {ResourceCtx} from '../../core/extend-resource.js'

import {resolveAddonId} from './internal/resolve-addon-id.js'

export type ListCredentialsOptions = {
  signal?: AbortSignal
}

export async function listCredentials(
  ctx: ResourceCtx,
  appIdentity: string,
  addonIdentity?: string,
  options: ListCredentialsOptions = {},
): Promise<PostgresDatabaseListCredentialsResult> {
  options.signal?.throwIfAborted()
  const addonId = await resolveAddonId(ctx.platform, appIdentity, addonIdentity)
  return ctx.data.postgresDatabase.listCredentials(addonId)
}

export const postgresDatabaseExtensions = extendResource('data', 'postgresDatabase', (ctx) => ({
  listCredentials: (
    appIdentity: string,
    addonIdentity?: string,
    options?: ListCredentialsOptions,
  ) => listCredentials(ctx, appIdentity, addonIdentity, options),
}))
```

- [ ] **Step 13.4: Run the test**

Run: `npm test -- src/resources/data/postgres-database.test.ts`
Expected: PASS.

- [ ] **Step 13.5: Write the failing test for `maintenance`**

Create `src/resources/data/maintenance.test.ts`:

```ts
import type {AddOnAttachment} from '@heroku/types/3.sdk'

import {describe, expect, it, vi} from 'vitest'

import type {ResourceCtx} from '../../core/extend-resource.js'

import {info, maintenanceExtensions} from './maintenance.js'

describe('info', () => {
  it('resolves the addon and calls maintenance.info', async () => {
    const resolution = vi.fn().mockResolvedValue([{addon: {id: 'addon-y'}}] as AddOnAttachment[])
    const maintenanceInfo = vi.fn().mockResolvedValue({state: 'scheduled'})
    const ctx: ResourceCtx = {
      data: {maintenance: {info: maintenanceInfo}} as never,
      platform: {addOnAttachment: {resolution}} as never,
    }

    const result = await info(ctx, 'app-1', 'DATABASE_URL')

    expect(maintenanceInfo).toHaveBeenCalledWith('addon-y')
    expect(result).toEqual({state: 'scheduled'})
  })
})

describe('maintenanceExtensions', () => {
  it('declares service: data, resource: maintenance', () => {
    expect(maintenanceExtensions.service).toBe('data')
    expect(maintenanceExtensions.resource).toBe('maintenance')
  })
})
```

- [ ] **Step 13.6: Run the test to confirm it fails**

Run: `npm test -- src/resources/data/maintenance.test.ts`
Expected: FAIL.

- [ ] **Step 13.7: Implement the resource**

Create `src/resources/data/maintenance.ts`:

```ts
import type {MaintenanceInfoResult} from '@heroku/types/data'

import {extendResource} from '../../core/extend-resource.js'
import type {ResourceCtx} from '../../core/extend-resource.js'

import {resolveAddonId} from './internal/resolve-addon-id.js'

export type MaintenanceInfoOptions = {
  signal?: AbortSignal
}

export async function info(
  ctx: ResourceCtx,
  appIdentity: string,
  addonIdentity?: string,
  options: MaintenanceInfoOptions = {},
): Promise<MaintenanceInfoResult> {
  options.signal?.throwIfAborted()
  const addonId = await resolveAddonId(ctx.platform, appIdentity, addonIdentity)
  return ctx.data.maintenance.info(addonId)
}

export const maintenanceExtensions = extendResource('data', 'maintenance', (ctx) => ({
  info: (
    appIdentity: string,
    addonIdentity?: string,
    options?: MaintenanceInfoOptions,
  ) => info(ctx, appIdentity, addonIdentity, options),
}))
```

- [ ] **Step 13.8: Run the test**

Run: `npm test -- src/resources/data/maintenance.test.ts`
Expected: PASS.

- [ ] **Step 13.9: Commit**

```bash
git add src/resources/data/postgres-database.ts src/resources/data/postgres-database.test.ts src/resources/data/maintenance.ts src/resources/data/maintenance.test.ts
git commit -m "feat(resources): add data/postgres-database and data/maintenance resources"
```

---

### Task 14: Create the data extensions barrel and convert the `pg` composition to a transitional alias

**Files:**
- Create: `src/resources/extensions/data.ts`
- Modify: `src/compositions/pg.ts` (full rewrite)

- [ ] **Step 14.1: Create the data barrel**

Create `src/resources/extensions/data.ts`:

```ts
export {databaseExtensions} from '../data/database.js'
export {maintenanceExtensions} from '../data/maintenance.js'
export {postgresDatabaseExtensions} from '../data/postgres-database.js'
```

- [ ] **Step 14.2: Rewrite `src/compositions/pg.ts`**

Replace the entire contents of `src/compositions/pg.ts` with:

```ts
import type {HerokuApiClientOptions} from '@heroku/api-client'
import type {
  DatabaseInfoResult,
  DatabasePrepareUpgradeResult,
  DatabaseRunUpgradeResult,
  MaintenanceInfoResult,
  PostgresDatabaseListCredentialsResult,
  TransferListByAppResult,
} from '@heroku/types/data'

import type {ResourceCtx} from '../core/extend-resource.js'

import {createDataClient} from '../services/data.js'
import {createPlatformClient} from '../services/platform.js'

import * as databaseResource from '../resources/data/database.js'
import * as maintenanceResource from '../resources/data/maintenance.js'
import * as postgresDatabaseResource from '../resources/data/postgres-database.js'

export type PgOptions = {
  clientOptions?: HerokuApiClientOptions
  signal?: AbortSignal
}

export type PgUpgradeOpts = {
  version?: string
}

function makeCtx(options: PgOptions): ResourceCtx {
  let platform: ReturnType<typeof createPlatformClient> | undefined
  let data: ReturnType<typeof createDataClient> | undefined
  return {
    get data() {
      data ??= createDataClient(options.clientOptions)
      return data
    },
    get platform() {
      platform ??= createPlatformClient(options.clientOptions)
      return platform
    },
  }
}

export async function describePgDatabase(
  appIdentity: string,
  addonIdentity?: string,
  options: PgOptions = {},
): Promise<DatabaseInfoResult> {
  return databaseResource.describe_(makeCtx(options), appIdentity, addonIdentity, {
    signal: options.signal,
  })
}

export async function listPgCredentials(
  appIdentity: string,
  addonIdentity?: string,
  options: PgOptions = {},
): Promise<PostgresDatabaseListCredentialsResult> {
  return postgresDatabaseResource.listCredentials(makeCtx(options), appIdentity, addonIdentity, {
    signal: options.signal,
  })
}

export async function describePgMaintenance(
  appIdentity: string,
  addonIdentity?: string,
  options: PgOptions = {},
): Promise<MaintenanceInfoResult> {
  return maintenanceResource.info(makeCtx(options), appIdentity, addonIdentity, {
    signal: options.signal,
  })
}

export async function listPgTransfers(
  appIdentity: string,
  options: PgOptions = {},
): Promise<TransferListByAppResult> {
  options.signal?.throwIfAborted()
  return makeCtx(options).data.transfer.listByApp(appIdentity)
}

export async function runPgUpgrade(
  appIdentity: string,
  addonIdentity?: string,
  body: PgUpgradeOpts = {},
  options: PgOptions = {},
): Promise<DatabaseRunUpgradeResult> {
  return databaseResource.runUpgrade(makeCtx(options), appIdentity, addonIdentity, body, {
    signal: options.signal,
  })
}

export async function preparePgUpgrade(
  appIdentity: string,
  addonIdentity?: string,
  body: PgUpgradeOpts = {},
  options: PgOptions = {},
): Promise<DatabasePrepareUpgradeResult> {
  return databaseResource.prepareUpgrade(makeCtx(options), appIdentity, addonIdentity, body, {
    signal: options.signal,
  })
}
```

- [ ] **Step 14.3: Run the existing composition test**

Run: `npm test -- src/compositions/pg.test.ts`
Expected: PASS — all eleven tests green.

- [ ] **Step 14.4: Run the full test suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 14.5: Run the build to confirm types compile**

Run: `npm run build`
Expected: SUCCESS.

- [ ] **Step 14.6: Commit**

```bash
git add src/resources/extensions/data.ts src/compositions/pg.ts
git commit -m "refactor(compositions): route pg composition through resources/data/*"
```

---

# Phase 5 — Barrel completeness tests (Step 5 from the spec)

---

### Task 15: Glob-driven barrel-completeness tests

**Files:**
- Create: `src/resources/extensions/platform.test.ts`
- Create: `src/resources/extensions/data.test.ts`

- [ ] **Step 15.1: Write the platform barrel test**

Create `src/resources/extensions/platform.test.ts`:

```ts
import {readdir} from 'node:fs/promises'
import {dirname, join} from 'node:path'
import {fileURLToPath} from 'node:url'

import {describe, expect, it} from 'vitest'

import type {ResourceExtension} from '../../core/extend-resource.js'

import * as barrel from './platform.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const PLATFORM_DIR = join(__dirname, '..', 'platform')

async function findExtensionExports(): Promise<Map<string, ResourceExtension>> {
  const entries = await readdir(PLATFORM_DIR, {withFileTypes: true})
  const sourceFiles = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts'))
    .map((entry) => entry.name)

  const exports = new Map<string, ResourceExtension>()
  for (const file of sourceFiles) {
    // eslint-disable-next-line no-await-in-loop
    const mod = await import(join(PLATFORM_DIR, file))
    for (const [exportName, value] of Object.entries(mod)) {
      if (exportName.endsWith('Extensions') && isResourceExtension(value)) {
        exports.set(exportName, value)
      }
    }
  }

  return exports
}

function isResourceExtension(value: unknown): value is ResourceExtension {
  return Boolean(
    value
    && typeof value === 'object'
    && 'service' in value
    && 'resource' in value
    && 'factory' in value,
  )
}

describe('platform extensions barrel', () => {
  it('re-exports every *Extensions value found in src/resources/platform/*.ts', async () => {
    const sourceExports = await findExtensionExports()
    expect(sourceExports.size).toBeGreaterThan(0)

    const barrelKeys = new Set(Object.keys(barrel))
    for (const exportName of sourceExports.keys()) {
      expect(barrelKeys, `barrel is missing ${exportName}`).toContain(exportName)
    }
  })

  it('every *Extensions in the barrel targets the platform service', () => {
    for (const [name, value] of Object.entries(barrel)) {
      if (!name.endsWith('Extensions')) continue
      expect((value as ResourceExtension).service, `${name} should target platform`).toBe('platform')
    }
  })
})
```

- [ ] **Step 15.2: Run the test**

Run: `npm test -- src/resources/extensions/platform.test.ts`
Expected: PASS — barrel exports `appExtensions`, `dynoExtensions`, `pipelinePromotionExtensions`; all target platform.

- [ ] **Step 15.3: Write the data barrel test**

Create `src/resources/extensions/data.test.ts`:

```ts
import {readdir} from 'node:fs/promises'
import {dirname, join} from 'node:path'
import {fileURLToPath} from 'node:url'

import {describe, expect, it} from 'vitest'

import type {ResourceExtension} from '../../core/extend-resource.js'

import * as barrel from './data.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const DATA_DIR = join(__dirname, '..', 'data')

async function findExtensionExports(): Promise<Map<string, ResourceExtension>> {
  const entries = await readdir(DATA_DIR, {withFileTypes: true})
  const sourceFiles = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts'))
    .map((entry) => entry.name)

  const exports = new Map<string, ResourceExtension>()
  for (const file of sourceFiles) {
    // eslint-disable-next-line no-await-in-loop
    const mod = await import(join(DATA_DIR, file))
    for (const [exportName, value] of Object.entries(mod)) {
      if (exportName.endsWith('Extensions') && isResourceExtension(value)) {
        exports.set(exportName, value)
      }
    }
  }

  return exports
}

function isResourceExtension(value: unknown): value is ResourceExtension {
  return Boolean(
    value
    && typeof value === 'object'
    && 'service' in value
    && 'resource' in value
    && 'factory' in value,
  )
}

describe('data extensions barrel', () => {
  it('re-exports every *Extensions value found in src/resources/data/*.ts', async () => {
    const sourceExports = await findExtensionExports()
    expect(sourceExports.size).toBeGreaterThan(0)

    const barrelKeys = new Set(Object.keys(barrel))
    for (const exportName of sourceExports.keys()) {
      expect(barrelKeys, `barrel is missing ${exportName}`).toContain(exportName)
    }
  })

  it('every *Extensions in the barrel targets the data service', () => {
    for (const [name, value] of Object.entries(barrel)) {
      if (!name.endsWith('Extensions')) continue
      expect((value as ResourceExtension).service, `${name} should target data`).toBe('data')
    }
  })
})
```

The `internal/` subdirectory is excluded automatically because the loop uses `readdir` (without recursion) and only matches direct `.ts` files in `data/`.

- [ ] **Step 15.4: Run the test**

Run: `npm test -- src/resources/extensions/data.test.ts`
Expected: PASS — barrel exports `databaseExtensions`, `maintenanceExtensions`, `postgresDatabaseExtensions`; all target data.

- [ ] **Step 15.5: Run the full test suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 15.6: Commit**

```bash
git add src/resources/extensions/platform.test.ts src/resources/extensions/data.test.ts
git commit -m "test(resources): add glob-driven barrel completeness tests"
```

---

# Phase 6 — Documentation and examples (Step 6 from the spec)

---

### Task 16: Add SDK examples and update CLAUDE.md

**Files:**
- Create: `examples/sdk-usage.ts`
- Create: `examples/sdk-tree-shaken.ts`
- Modify: `CLAUDE.md`

- [ ] **Step 16.1: Create `examples/sdk-usage.ts`**

```ts
// Run: npm run example -- examples/sdk-usage.ts
// Requires: HEROKU_API_KEY in env or a valid .netrc entry for api.heroku.com.

import {HerokuSDK} from '@heroku/sdk/sdk'
import {appExtensions, dynoExtensions} from '@heroku/sdk/extensions/platform'
import {databaseExtensions} from '@heroku/sdk/extensions/data'

const sdk = new HerokuSDK({
  extensions: [appExtensions, dynoExtensions, databaseExtensions],
})

const app = process.argv[2] ?? 'my-app'

// Extension method (hand-written)
await sdk.platform.app.enableMaintenance(app)

// Upstream route method (still typed and callable on the same namespace)
const info = await sdk.platform.app.info(app)
console.log(`maintenance=${info.maintenance}`)

await sdk.platform.app.disableMaintenance(app)
```

- [ ] **Step 16.2: Create `examples/sdk-tree-shaken.ts`**

```ts
// Run: npm run example -- examples/sdk-tree-shaken.ts
// Demonstrates the most aggressive bundle path: no SDK class, no extension
// registry — just named-function imports.

import {createDataClient} from '@heroku/sdk/data'
import {createPlatformClient} from '@heroku/sdk/platform'
import {describe_ as describeDatabase} from '@heroku/sdk/resources/data/database'

const platform = createPlatformClient()
const data = createDataClient()

const app = process.argv[2] ?? 'my-app'

const result = await describeDatabase({data, platform}, app)
console.log(result)
```

- [ ] **Step 16.3: Update `CLAUDE.md`**

In the `## Architecture` section of `CLAUDE.md`, replace the existing description with content that reflects the new layered architecture. Specifically:

1. After the `**Public surface:**` block, add the following block:

```markdown
**SDK class (`@heroku/sdk/sdk` → `HerokuSDK`):** Combines per-service clients with hand-written resource extensions. Lazy per-service getters return Proxy-merged views: `sdk.platform.app.enableMaintenance()` is a hand-written method, `sdk.platform.app.info()` is the upstream route, both available on the same namespace. Extension bundles are imported by name from `@heroku/sdk/extensions/<service>` and passed at construction.

**Resource modules (`src/resources/<service>/<resource>.ts`):** Each resource module exports both tree-shakable named functions (callable with explicit `ctx`) and an `*Extensions` bundle produced by `extendResource`. The bundle is mechanical delegation — every method delegates one-line into the corresponding named function. Cross-service helpers (e.g., the pg flow that needs both platform and data clients) destructure both services from `ctx`.

**`compositions/` is deprecated:** Each composition file is now a transitional alias that constructs a lazy `ResourceCtx` from the legacy `clientOptions` shape and delegates to a named function in `src/resources/`. New code should use `HerokuSDK` (with `extensions/<service>`) or named-function imports from `resources/<service>/<resource>.ts`.
```

2. In the `## Project Layout` block, update the tree to include the new directories:

```
src/
  index.ts                         # root export — HerokuApiClientOptions only
  services/
    platform.ts                    # createPlatformClient + PlatformClient type
    data.ts                        # createDataClient + DataClient type
  core/
    create-client.ts               # generic createClient<T>(routes, opts) — internal
    dispatcher.ts                  # route → HTTP call mapping
    interpolate-path.ts            # {placeholder} substitution
    extend-resource.ts             # extendResource + ResourceCtx + type utilities
    extensions-proxy.ts            # mergeExtensions Proxy
    heroku-sdk.ts                  # HerokuSDK class (generic in Exts)
    *.test.ts                      # co-located vitest tests
  resources/
    extensions/
      platform.ts                  # curated barrel of platform *Extensions
      data.ts                      # curated barrel of data *Extensions
    platform/
      app.ts                       # named fns + appExtensions
      dyno.ts                      # named fns + dynoExtensions
      pipeline-promotion.ts        # named fns + pipelinePromotionExtensions
    data/
      database.ts                  # named fns + databaseExtensions
      maintenance.ts               # named fns + maintenanceExtensions
      postgres-database.ts         # named fns + postgresDatabaseExtensions
      internal/
        resolve-addon-id.ts        # shared helper
  compositions/
    app.ts                         # @deprecated — alias over resources/platform/app
    dyno.ts                        # @deprecated — alias over resources/platform/dyno
    pipeline.ts                    # @deprecated — alias over resources/platform/pipeline-promotion
    pg.ts                          # @deprecated — alias over resources/data/*
examples/
  basic-usage.ts                   # platform usage example
  data-usage.ts                    # data usage example
  sdk-usage.ts                     # HerokuSDK + extensions example
  sdk-tree-shaken.ts               # named-function path (smallest bundle)
```

- [ ] **Step 16.4: Run the build to confirm examples typecheck**

Run: `npm run build`
Expected: SUCCESS.

- [ ] **Step 16.5: Commit**

```bash
git add examples/sdk-usage.ts examples/sdk-tree-shaken.ts CLAUDE.md
git commit -m "docs: add SDK examples and document the resource extensions architecture"
```

---

# Phase 7 — Mark `compositions/` as deprecated (Step 7 from the spec)

---

### Task 17: Add `@deprecated` JSDoc to every composition export

**Files:**
- Modify: `src/compositions/app.ts`
- Modify: `src/compositions/dyno.ts`
- Modify: `src/compositions/pipeline.ts`
- Modify: `src/compositions/pg.ts`

- [ ] **Step 17.1: Add `@deprecated` JSDoc to `app.ts`**

In `src/compositions/app.ts`, add a JSDoc comment immediately above the `enableMaintenanceMode` and `disableMaintenanceMode` exports:

```ts
/**
 * @deprecated Use `sdk.platform.app.enableMaintenance` from `@heroku/sdk/sdk` with
 * `appExtensions` from `@heroku/sdk/extensions/platform`, or import `enableMaintenance`
 * directly from `@heroku/sdk/resources/platform/app`.
 */
export async function enableMaintenanceMode(...) { /* ... */ }

/**
 * @deprecated Use `sdk.platform.app.disableMaintenance` from `@heroku/sdk/sdk` with
 * `appExtensions` from `@heroku/sdk/extensions/platform`, or import `disableMaintenance`
 * directly from `@heroku/sdk/resources/platform/app`.
 */
export async function disableMaintenanceMode(...) { /* ... */ }
```

- [ ] **Step 17.2: Add `@deprecated` JSDoc to `dyno.ts`**

```ts
/**
 * @deprecated Use `sdk.platform.dyno.scale` from `@heroku/sdk/sdk` with
 * `dynoExtensions` from `@heroku/sdk/extensions/platform`, or import `scaleDynos`
 * directly from `@heroku/sdk/resources/platform/dyno`.
 */
export function scaleDynos(...)

/**
 * @deprecated Use `sdk.platform.dyno.restart` from `@heroku/sdk/sdk` with
 * `dynoExtensions` from `@heroku/sdk/extensions/platform`, or import `restartDynos`
 * directly from `@heroku/sdk/resources/platform/dyno`.
 */
export async function restartDynos(...)
```

- [ ] **Step 17.3: Add `@deprecated` JSDoc to `pipeline.ts`**

```ts
/**
 * @deprecated Use `sdk.platform.pipelinePromotion.promote` from `@heroku/sdk/sdk` with
 * `pipelinePromotionExtensions` from `@heroku/sdk/extensions/platform`, or import
 * `promotePipeline` directly from `@heroku/sdk/resources/platform/pipeline-promotion`.
 */
export async function promotePipeline(...)
```

- [ ] **Step 17.4: Add `@deprecated` JSDoc to `pg.ts`**

For each of `describePgDatabase`, `listPgCredentials`, `describePgMaintenance`, `listPgTransfers`, `runPgUpgrade`, `preparePgUpgrade`, add a JSDoc pointing at the corresponding new resource. Example for `describePgDatabase`:

```ts
/**
 * @deprecated Use `sdk.data.database.describe` from `@heroku/sdk/sdk` with
 * `databaseExtensions` from `@heroku/sdk/extensions/data`, or import `describe_`
 * directly from `@heroku/sdk/resources/data/database`.
 */
export async function describePgDatabase(...)
```

Apply the same pattern to each remaining export, pointing at:

- `listPgCredentials` → `sdk.data.postgresDatabase.listCredentials` / `@heroku/sdk/resources/data/postgres-database` (`listCredentials`)
- `describePgMaintenance` → `sdk.data.maintenance.info` / `@heroku/sdk/resources/data/maintenance` (`info`)
- `listPgTransfers` → upstream route `sdk.data.transfer.listByApp` directly (no extension needed)
- `runPgUpgrade` → `sdk.data.database.runUpgrade` / `@heroku/sdk/resources/data/database` (`runUpgrade`)
- `preparePgUpgrade` → `sdk.data.database.prepareUpgrade` / `@heroku/sdk/resources/data/database` (`prepareUpgrade`)

- [ ] **Step 17.5: Run the full test suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 17.6: Run the build**

Run: `npm run build`
Expected: SUCCESS.

- [ ] **Step 17.7: Commit**

```bash
git add src/compositions/app.ts src/compositions/dyno.ts src/compositions/pipeline.ts src/compositions/pg.ts
git commit -m "refactor(compositions): mark all composition exports as @deprecated"
```

---

# Final verification

### Task 18: End-to-end verification

- [ ] **Step 18.1: Run the full test suite**

Run: `npm test`
Expected: All tests green. Total test count should reflect all the new resource and barrel tests.

- [ ] **Step 18.2: Run the build**

Run: `npm run build`
Expected: SUCCESS — `dist/` produced with no type errors.

- [ ] **Step 18.3: Verify the new subpath exports resolve**

Run: `node -e "console.log(require.resolve('@heroku/sdk/sdk'))" 2>&1 || true`

(May fail in dev because the package isn't installed by name; this is just a sanity check that the file exists at the expected dist path. Acceptable to skip.)

Confirm the dist contents:

```bash
ls dist/core/heroku-sdk.js dist/resources/extensions/platform.js dist/resources/extensions/data.js
```

Expected: all three files exist.

- [ ] **Step 18.4: Run lint**

Run: `npm run lint`
Expected: PASS — no new lint errors introduced. (Existing eslint config from `@heroku-cli/test-utils`.)

- [ ] **Step 18.5: Confirm CHANGELOG mention is unnecessary or add an entry per repo convention**

Check `CHANGELOG.md` for whether the repo manages a changelog (look at last entry). If yes, add an entry under an "Unreleased" or next-version heading describing the new SDK class, the extension architecture, and the deprecation of `compositions/`. If the repo doesn't maintain a manual changelog, skip.

---

## Self-review

After writing the plan, I checked it against the spec.

**Spec coverage:**

- Goals (1) `sdk.x.y.z()` ergonomics → Tasks 5–14 (resource modules) + Task 3 (HerokuSDK).
- Goals (2) preserved upstream route access → covered by `mergeExtensions` (Task 2) and verified in Task 3 tests.
- Goals (3) tree-shakable → Task 4 (`sideEffects: false` + subpath exports).
- Goals (4) cross-service helpers → Task 12 (database) + Task 13 (postgres-database, maintenance) using `ResourceCtx` with both services.
- Goals (5) typed extension methods → `ApplyExtensions` in Task 1, exercised in Task 3.
- Goals (6) mechanical migration → all phase 2/3/4 tasks follow the same template.
- Public API: subpath exports added in Task 4, two consumer paths shown in examples (Task 16).
- `extendResource` signature: Task 1 matches the spec exactly.
- `ResourceCtx` shape: Task 1 matches the spec.
- Resource module pattern: Tasks 5/7/9/12/13 follow the spec template.
- Curated service barrels: Tasks 6, 8, 10, 14.
- `HerokuSDK` constructor: Task 3.
- `mergeExtensions` behavior: Task 2 covers all branches from the spec.
- Multiple extensions on same resource: Task 2 test (`combines methods from multiple extensions targeting the same resource`).
- Collision policy (extensions win + debug log): Task 2 implementation.
- Type composition: Task 1 (sketches → actual code).
- Compositions transitional alias pattern: Tasks 6, 8, 10, 14 use lazy `makeCtx`.
- Testing strategy: each resource task has named-function tests + extension-bundle smoke tests; Task 15 has glob barrel tests.
- Migration plan steps 1-7 from the spec map 1:1 to phases 1-7 here.

**Placeholder scan:** Searched for "TBD", "TODO", "implement later", "appropriate error handling", "similar to". None present. Every code block is complete.

**Type consistency check:**

- `extendResource(service, resource, factory)` — same signature in Task 1 and used identically in Tasks 5, 7, 9, 12, 13.
- `ResourceCtx` shape `{platform, data}` — consistent across all tasks.
- `HerokuSDK` constructor takes `{extensions?, clientOptions?}` — consistent in Task 3 and example (Task 16).
- `appExtensions`, `dynoExtensions`, `pipelinePromotionExtensions`, `databaseExtensions`, `postgresDatabaseExtensions`, `maintenanceExtensions` — names consistent throughout barrel and resource files.
- Named-function name `describe_` (with trailing underscore to avoid clashing with vitest's `describe`) consistent in Task 12, Task 14 (alias), and Task 16 (example).
- `dynoExtensions` exposes methods `scale` and `restart` (not `scaleDynos`/`restartDynos`) — note the spec talks about `enableMaintenance` etc. on the resource, not the prefixed name; aligned with the convention in Task 5.
- `pipelinePromotionExtensions.promote` — extension method name is `promote`, not `promotePipeline`. Same naming convention.

One potential issue I want to flag for the engineer: in the `dyno.ts` resource module (Task 7), the extension factory uses a `as` cast to preserve the overload signatures of `scaleDynos`. If TypeScript is stricter than expected, the engineer may need to adjust the cast or move the overload signatures into a separate type. The named-function tests cover both code paths so the runtime behavior is verified regardless.

No other gaps found. Ready for execution.
