# Resource Extensions Design

**Status:** Approved (brainstorm)
**Date:** 2026-05-18
**Branch:** `refactor/resources`

## Summary

Add an `extendResource` mechanism that lets us define hand-written methods on `HerokuClient` resources (e.g., `sdk.platform.app.enableMaintenance()`) without overwriting the upstream route methods generated from `@heroku/types`. The new SDK-level entry point, `HerokuSDK`, accepts an array of extension bundles at construction and exposes the merged surface through lazy per-service getters.

The design preserves tree-shaking by making extensions explicit values that consumers import and pass in (no module-load side effects), and by shipping curated, named-export bundles per service. Today's `src/compositions/` directory becomes a transitional alias layer over the new `src/resources/` directory and is marked for removal in a future major version.

## Goals

1. Allow `sdk.platform.app.enableMaintenance(appId)` and similar property-access ergonomics for hand-written methods.
2. Preserve full upstream route access on the same namespace (`sdk.platform.app.update(...)` still works without manual re-exposure).
3. Keep the SDK tree-shakable at the resource granularity. A consumer who uses only `appExtensions` should not bundle `databaseExtensions`.
4. Support cross-service helpers (e.g., the existing `pg` flow that needs both platform and data clients) as first-class resource extensions, not as a separate "compositions" surface.
5. Preserve the existing fully-typed experience: extension methods must show up in IntelliSense with correct argument and return types, alongside upstream route methods.
6. Keep migration mechanical. Each existing composition becomes a named function in a resource module, plus a one-line entry in an extension bundle.

## Non-goals

- Method-level tree-shaking. The `sdk.x.y.z()` shape is fundamentally incompatible with bundlers proving individual property accesses unused; resource-level granularity is the realistic ceiling.
- Build-time codegen of extension bundles. The hand-written delegation is small enough to be reviewed manually and gives us a place to add per-method behavior. Revisit if delegation becomes a maintenance pain.
- Removing `src/compositions/` in this work. It stays as a transitional alias and is deprecated, not deleted.
- Performance optimization of the doubled-client construction (see "Architecture / SDK class"). Real cost, unmeasurable until proven a problem.

## Architecture

The SDK has three runtime layers, increasing in ergonomic richness:

1. **Service clients** (`createPlatformClient`, `createDataClient`). Unchanged. Two-level Proxy over the upstream routes registry. Returns the upstream `HerokuClient` typed surface. No extensions involved at this layer.
2. **Resource modules** (`src/resources/<service>/<resource>.ts`). Pure modules with two parallel exports:
   - **Named functions**, each accepting an explicit `ctx` (or destructured services) as the first argument. These are tree-shakable, callable directly, and are the source of truth for behavior.
   - **An extension bundle**, produced by `extendResource(service, resource, factory)`. Each method in the bundle is a thin delegate to the corresponding named function.
3. **`HerokuSDK`** (`src/core/heroku-sdk.ts`). A class that holds lazy service clients and accepts an array of extension bundles at construction. Exposes Proxy-augmented service views: `sdk.platform.app.enableMaintenance(...)` checks the extension registry first, falls through to the route Proxy.

```
┌─────────────────────────────────────────────────────┐
│ HerokuSDK (generic in Exts)                         │
│   sdk.platform → mergeExtensions(rawPlatform, ...)  │
│   sdk.data     → mergeExtensions(rawData, ...)      │
└─────────────────────────────────────────────────────┘
              │                            │
              ▼                            ▼
   ┌────────────────────┐         ┌────────────────────┐
   │ Service clients    │         │ Resource modules   │
   │ raw routes Proxy   │         │ named fns +        │
   │ from @heroku/types │         │ extendResource(…)  │
   └────────────────────┘         └────────────────────┘
              │                            │
              └─── extensions call ────────┘
                   raw clients via ctx
```

## Public API

### Subpath exports (`package.json`)

```json
{
  "exports": {
    ".":                        "./dist/index.js",
    "./platform":               "./dist/services/platform.js",
    "./data":                   "./dist/services/data.js",
    "./sdk":                    "./dist/core/heroku-sdk.js",
    "./extensions/platform":    "./dist/resources/extensions/platform.js",
    "./extensions/data":        "./dist/resources/extensions/data.js",
    "./resources/*":            "./dist/resources/*.js",
    "./compositions/*":         "./dist/compositions/*.js"
  },
  "sideEffects": false
}
```

`"sideEffects": false` declares all package modules pure; bundlers may drop unreferenced exports.

### Consumer paths

**Tree-shaken named extensions (the headline path):**

```ts
import { HerokuSDK } from '@heroku/sdk/sdk'
import { appExtensions } from '@heroku/sdk/extensions/platform'
import { databaseExtensions } from '@heroku/sdk/extensions/data'

const sdk = new HerokuSDK({ extensions: [appExtensions, databaseExtensions] })
sdk.platform.app.enableMaintenance(appId)
sdk.platform.app.update(appId, { /* ... */ })   // upstream route, still typed
sdk.data.database.describe(appId)
```

**Tree-shaken named functions (most aggressive bundle):**

```ts
import { createPlatformClient } from '@heroku/sdk/platform'
import { createDataClient }     from '@heroku/sdk/data'
import { describe } from '@heroku/sdk/resources/data/database'

const platform = createPlatformClient()
const data     = createDataClient()
await describe({ platform, data }, appId)
```

The `import * from '@heroku/sdk/extensions/platform'` "everything" path is intentionally not supported. Every supported consumer path is bundle-aware.

### `HerokuSDK` constructor

```ts
new HerokuSDK<const Exts extends readonly ResourceExtension[]>({
  extensions?: Exts,
  clientOptions?: HerokuApiClientOptions,
})
```

- `clientOptions` is SDK-wide. The same options object is used for both services. Per-service options are not supported.
- `extensions` defaults to an empty array; an extension-free SDK gives the same typed surface as `createPlatformClient()` / `createDataClient()` directly.

### `extendResource`

```ts
function extendResource<
  S extends ServiceName,
  R extends string,
  M extends Record<string, (...args: any[]) => any>,
>(
  service: S,
  resource: R,
  factory: (ctx: ResourceCtx) => M,
): ResourceExtension<S, R, M>
```

Returns a plain descriptor (no side effects). All three generics are inferred from the call site, no annotations needed.

### `ResourceCtx`

```ts
type ResourceCtx = {
  platform: PlatformClient   // raw routes-only proxy
  data:     DataClient       // raw routes-only proxy
}
```

`ctx` exposes the **raw service clients**, not the extension-augmented `sdk.platform` / `sdk.data`. This is what keeps the type recursion bounded (extensions defined in terms of merged clients → merged clients defined in terms of extensions → infinite expansion). Cross-extension reuse happens by importing the named function directly, not by calling through `ctx`.

## Resource module pattern

Every resource in `src/resources/<service>/<resource>.ts` follows the same shape: named functions exporting the implementation, plus an `<resource>Extensions` value produced by `extendResource`. The extension is mechanical delegation — every method is a one-line call into the corresponding named function.

### Single-service example: `app`

```ts
// src/resources/platform/app.ts
import type { App } from '@heroku/types/3.sdk'
import type { ResourceCtx } from '../../core/extend-resource.js'
import { extendResource } from '../../core/extend-resource.js'

export type EnableMaintenanceOptions = { signal?: AbortSignal }

export async function enableMaintenance(
  ctx: ResourceCtx,
  appIdentity: string,
  options: EnableMaintenanceOptions = {},
): Promise<App> {
  options.signal?.throwIfAborted()
  return ctx.platform.app.update(appIdentity, { maintenance: true })
}

export async function disableMaintenance(
  ctx: ResourceCtx,
  appIdentity: string,
  options: EnableMaintenanceOptions = {},
): Promise<App> {
  options.signal?.throwIfAborted()
  return ctx.platform.app.update(appIdentity, { maintenance: false })
}

export const appExtensions = extendResource('platform', 'app', (ctx) => ({
  enableMaintenance:  (id: string, opts?: EnableMaintenanceOptions) =>
    enableMaintenance(ctx, id, opts),
  disableMaintenance: (id: string, opts?: EnableMaintenanceOptions) =>
    disableMaintenance(ctx, id, opts),
}))
```

### Cross-service example: `database` (pg)

```ts
// src/resources/data/database.ts
import type { DatabaseInfoResult, DatabaseRunUpgradeResult } from '@heroku/types/data'
import type { ResourceCtx } from '../../core/extend-resource.js'
import { extendResource } from '../../core/extend-resource.js'
import { resolveAddonId } from './internal/resolve-addon-id.js'

export type DescribeOptions   = { signal?: AbortSignal }
export type RunUpgradeOptions = { version?: string; signal?: AbortSignal }

export async function describe(
  ctx: ResourceCtx,
  appIdentity: string,
  addonIdentity?: string,
  options: DescribeOptions = {},
): Promise<DatabaseInfoResult> {
  options.signal?.throwIfAborted()
  const addonId = await resolveAddonId(ctx.platform, appIdentity, addonIdentity)
  return ctx.data.database.info(addonId)
}

export async function runUpgrade(
  ctx: ResourceCtx,
  appIdentity: string,
  addonIdentity: string | undefined,
  body: { version?: string } = {},
  options: RunUpgradeOptions = {},
): Promise<DatabaseRunUpgradeResult> {
  options.signal?.throwIfAborted()
  const addonId = await resolveAddonId(ctx.platform, appIdentity, addonIdentity)
  // Cast: routes.js declares hasRequestBody for runUpgrade but the generated
  // HerokuClient interface omits the body param (Shogun spec lacks a request schema).
  const fn = ctx.data.database.runUpgrade as
    (name: string, body: { version?: string }) => Promise<DatabaseRunUpgradeResult>
  return fn(addonId, body)
}

export const databaseExtensions = extendResource('data', 'database', (ctx) => ({
  describe:    (appId: string, addonId?: string, opts?: DescribeOptions) =>
    describe(ctx, appId, addonId, opts),
  runUpgrade:  (appId: string, addonId: string | undefined, body?: { version?: string }, opts?: RunUpgradeOptions) =>
    runUpgrade(ctx, appId, addonId, body, opts),
}))
```

Private helpers like `resolveAddonId` live in `src/resources/<service>/internal/` — not in the public exports map.

### Curated service barrels

```ts
// src/resources/extensions/platform.ts
export { appExtensions }      from '../platform/app.js'
export { dynoExtensions }     from '../platform/dyno.js'
export { pipelinePromotionExtensions } from '../platform/pipeline-promotion.js'

// src/resources/extensions/data.ts
export { databaseExtensions } from '../data/database.js'
```

Pure re-exports. Bundlers keep only the named extensions a consumer references.

## SDK class and Proxy merge

### `HerokuSDK`

```ts
// src/core/heroku-sdk.ts
export class HerokuSDK<
  const Exts extends readonly ResourceExtension[] = readonly ResourceExtension[],
> {
  #clientOptions: HerokuApiClientOptions
  #extensionsByService: Map<ServiceName, ResourceExtension[]>
  #rawPlatform: PlatformClient | undefined
  #rawData:     DataClient | undefined
  #ctx: ResourceCtx | undefined
  #platform: unknown
  #data:     unknown

  constructor(options: { extensions?: Exts; clientOptions?: HerokuApiClientOptions } = {}) {
    this.#clientOptions = options.clientOptions ?? {}
    this.#extensionsByService = partitionByService(options.extensions ?? [])
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

  #getRawPlatform(): PlatformClient {
    if (!this.#rawPlatform) this.#rawPlatform = createPlatformClient(this.#clientOptions)
    return this.#rawPlatform
  }
  #getRawData(): DataClient {
    if (!this.#rawData) this.#rawData = createDataClient(this.#clientOptions)
    return this.#rawData
  }
  #getCtx(): ResourceCtx {
    if (!this.#ctx) {
      this.#ctx = {
        platform: this.#getRawPlatform(),
        data:     this.#getRawData(),
      }
    }
    return this.#ctx
  }
}
```

The `ctx` reuses the same raw clients held by the SDK (one raw per service, not two). The merged-vs-raw distinction is at the *Proxy wrapper* level: `sdk.platform` is the merged Proxy; `ctx.platform` is the underlying raw Proxy. Same `HerokuApiClient` underneath.

### `mergeExtensions`

```ts
// src/core/extensions-proxy.ts
export function mergeExtensions<T extends object>(
  routesProxy: T,
  extensions: ResourceExtension[],
  ctx: ResourceCtx,
): T {
  const methodsByResource = new Map<string, Record<string, Function>>()
  for (const ext of extensions) {
    const existing = methodsByResource.get(ext.resource) ?? {}
    methodsByResource.set(ext.resource, { ...existing, ...ext.factory(ctx) })
  }

  // Optional: at this point, walk methodsByResource and emit a debug log
  // for any (resource, method) that also exists on routesProxy.

  return new Proxy(routesProxy, {
    get(target, resourceKey: string, receiver) {
      const extMethods   = methodsByResource.get(resourceKey)
      const routeResource = Reflect.get(target, resourceKey, receiver)

      if (!extMethods) return routeResource

      return new Proxy(routeResource ?? {}, {
        get(routeTarget, methodKey: string, methodReceiver) {
          if (Object.hasOwn(extMethods, methodKey)) {
            return extMethods[methodKey]
          }
          return Reflect.get(routeTarget, methodKey, methodReceiver)
        },
      })
    },
  }) as T
}
```

Behavior:
- **Resource present in both extensions and routes:** returns merged Proxy where extension methods take precedence.
- **Resource only in extensions** (brand-new namespace): returns the extension methods directly, no route fallthrough needed.
- **Resource only in routes** (no extensions registered): passes through unchanged.
- **Method only in routes** (extension exists for the resource but doesn't define this method): falls through to the route.
- **Unknown resource:** returns `undefined`, matching today's `create-client.ts` behavior.

### Multiple extensions on the same resource

If two `extendResource('platform', 'app', ...)` calls are passed to one SDK, their method records merge (later wins on collision within extensions). This is the type-level intersection from `ApplyExtensions` projected onto runtime via the loop in `mergeExtensions`.

### Collision policy

**Extensions win.** When an extension method name collides with an upstream route name, the extension is invoked. This enables intentional wrapping (e.g., adding validation, defaults, fixing upstream bugs without forking).

A `debug` log fires at construction when an extension method shadows an upstream route. Visible to anyone running with `DEBUG=heroku:sdk:*`, invisible otherwise. No throw, no warning to stderr.

## Type composition

```ts
// src/core/extend-resource.ts (sketch)
export type ServiceName = 'platform' | 'data'

export type ResourceExtension<
  S extends ServiceName = ServiceName,
  R extends string = string,
  M extends Record<string, (...args: any[]) => any> = Record<string, (...args: any[]) => any>,
> = {
  service:  S
  resource: R
  factory:  (ctx: ResourceCtx) => M
}

type UnionToIntersection<U> =
  (U extends any ? (k: U) => void : never) extends (k: infer I) => void ? I : never

type ExtensionsFor<Exts extends readonly ResourceExtension[], S extends ServiceName> =
  Extract<Exts[number], ResourceExtension<S, string, any>>

type MethodsForResource<E, R extends string> =
  UnionToIntersection<E extends ResourceExtension<any, R, infer M> ? M : never>

type ApplyExtensions<Base, E> =
  & { [K in keyof Base]:
      [E] extends [ResourceExtension<any, infer _R, any>]
        ? K extends (E extends ResourceExtension<any, infer R, any> ? R : never)
          ? Base[K] & MethodsForResource<E, K & string>
          : Base[K]
        : Base[K]
    }
  & {
      [K in (E extends ResourceExtension<any, infer R, any> ? R : never) as
        K extends keyof Base ? never : K
      ]: MethodsForResource<E, K & string>
    }
```

Notes:
- `const Exts` on `HerokuSDK` is critical — without it, `[appExtensions, databaseExtensions]` widens to `ResourceExtension[]` and the per-element literals are lost.
- An extension-free SDK (`Exts = readonly ResourceExtension[]`) collapses `ApplyExtensions<Base, ...>` back to `Base`. No degradation.
- A consumer who stores a typed reference can either (a) let inference do its thing (`const sdk = new HerokuSDK({ extensions: [...] })`) or (b) write `HerokuSDK<typeof myExtensions>` when they need an explicit annotation.

## Compositions: transitional alias

Each `src/compositions/*.ts` becomes a small adapter that constructs a `ResourceCtx` from the legacy `clientOptions` shape and delegates to the named function in `src/resources/`.

```ts
// src/compositions/app.ts (after migration)
import type { App } from '@heroku/types/3.sdk'
import type { HerokuApiClientOptions } from '@heroku/api-client'
import { createPlatformClient } from '../services/platform.js'
import { createDataClient }     from '../services/data.js'
import * as appResource from '../resources/platform/app.js'

type LegacyOptions = { clientOptions?: HerokuApiClientOptions; signal?: AbortSignal }

function ctx(options: LegacyOptions) {
  return {
    platform: createPlatformClient(options.clientOptions),
    data:     createDataClient(options.clientOptions),
  }
}

/** @deprecated Use `sdk.platform.app.enableMaintenance` or import { enableMaintenance } from '@heroku/sdk/resources/platform/app'. */
export const enableMaintenanceMode = (id: string, options: LegacyOptions = {}) =>
  appResource.enableMaintenance(ctx(options), id, { signal: options.signal })

/** @deprecated Use `sdk.platform.app.disableMaintenance` or import { disableMaintenance } from '@heroku/sdk/resources/platform/app'. */
export const disableMaintenanceMode = (id: string, options: LegacyOptions = {}) =>
  appResource.disableMaintenance(ctx(options), id, { signal: options.signal })
```

Public behavior is preserved: same exports, same signatures, same defaults. Internals route through the new layer. Removal scheduled for a future major version.

## Testing strategy

The architecture pushes testing to the layer where it's cheapest.

### Named function tests (the bulk)

Named functions take `ctx` positionally — testable without any SDK or Proxy machinery:

```ts
const update = vi.fn().mockResolvedValue({ id: 'abc', maintenance: true })
const ctx = { platform: { app: { update } } as any, data: {} as any }
await appResource.enableMaintenance(ctx, 'my-app')
expect(update).toHaveBeenCalledWith('my-app', { maintenance: true })
```

No `@heroku/api-client` mocking, no `createPlatformClient` invocation. Shape-matched fakes, fast.

### Extension bundle tests (thin)

Three assertions per resource:
1. `service` and `resource` literals are correct.
2. `factory(ctx)` returns the expected method names.
3. One smoke test per method confirming it delegates to the named function (calls the right route through `ctx`).

### `extendResource` tests

Trivial: returns the descriptor with the right keys, factory is callable. Optional `expectTypeOf` test for literal preservation.

### `HerokuSDK` tests

1. **Lazy construction.** `new HerokuSDK()` does not construct any HTTP clients. Accessing `sdk.platform` constructs exactly one raw client. Accessing it again does not reconstruct.
2. **Extension routing.** Given an extension array spanning both services, `sdk.platform.app.enableMaintenance` returns the extension method, `sdk.data.database.describe` returns the extension method, and `sdk.platform.app.update` passes through to the route.
3. **Collision behavior.** When an extension method shadows a route, the extension wins; the debug log fires at construction.

These mock `@heroku/api-client` the same way `services/*.test.ts` already do.

### `mergeExtensions` tests

Direct unit tests on the pure function. One test per branch in the "Behavior" list above (resource in both, only extensions, only routes, method only in routes, unknown resource).

### Compositions transitional aliases

Existing `src/compositions/*.test.ts` files keep their tests verbatim — public behavior must not change. They now exercise both the alias adapter and the new named function in one go.

### Glob-driven barrel completeness

`src/resources/extensions/<service>.test.ts` walks `src/resources/<service>/*.ts`, dynamically imports each, and asserts every `*Extensions` named export is reachable via the barrel. Catches the failure mode where someone adds a resource file but forgets to update the barrel.

## Migration plan

The migration is staged so each step produces a working repo. PRs land in this order; each is mergeable on its own.

### Step 1 — Land core scaffolding

Files:
- `src/core/extend-resource.ts` (`extendResource`, `ResourceCtx`, `ResourceExtension`, `ServiceName`, type utilities).
- `src/core/extensions-proxy.ts` (`mergeExtensions`).
- `src/core/heroku-sdk.ts` (replace placeholder with constructor + lazy getters + generic `Exts`).
- Tests for all three.
- `package.json` exports map: add `./sdk`, `./extensions/*`, `./resources/*`. Set `"sideEffects": false`.

After Step 1: `HerokuSDK` is importable but has no extensions yet. `compositions/` and `services/` untouched. The repo builds, tests pass, no public API change.

This is the only step carrying significant architectural risk (types, Proxy logic). Reviewer attention concentrated here.

### Step 2 — Migrate `app` (canary)

- `src/resources/platform/app.ts` with `enableMaintenance`, `disableMaintenance`, `appExtensions`.
- `src/resources/extensions/platform.ts` re-exporting `appExtensions`.
- Replace `src/compositions/app.ts` with the transitional adapter.
- `src/resources/platform/app.test.ts` for the new layer.
- Existing `src/compositions/app.test.ts` keeps passing.

Proves the architecture against real types and a real upstream client. If anything in the type plumbing is wrong, this is where it surfaces.

### Step 3 — Migrate remaining single-service resources

- `src/compositions/dyno.ts` → `src/resources/platform/dyno.ts` + `dynoExtensions`.
- `src/compositions/pipeline.ts` → `src/resources/platform/pipeline-promotion.ts` + `pipelinePromotionExtensions`. The polling helper inside `promotePipeline` stays private to the file.
- Each: new resource file, transitional alias in `compositions/`, test files.
- Update `src/resources/extensions/platform.ts` to re-export each new bundle.

### Step 4 — Migrate cross-service `pg`

- `src/resources/data/database.ts` with `describe`, `runUpgrade`, `prepareUpgrade`, etc., plus `databaseExtensions`.
- `src/resources/data/internal/resolve-addon-id.ts` for the shared addon-resolution helper.
- Possibly other data resources (`postgresDatabase`, `maintenance`, `transfer`) get their own files if their methods don't naturally belong on `database`.
- `src/resources/extensions/data.ts` re-exports the bundles.
- `src/compositions/pg.ts` becomes the transitional adapter.

First exercise of cross-service `ctx` against real upstream types.

### Step 5 — Barrel-completeness tests

- `src/resources/extensions/platform.test.ts` — glob `src/resources/platform/*.ts`, assert every `*Extensions` export is reachable via the barrel.
- `src/resources/extensions/data.test.ts` — same for data.

### Step 6 — Documentation and examples

- `examples/sdk-usage.ts` — `new HerokuSDK({ extensions: [...] })` with named-extension path.
- `examples/sdk-tree-shaken.ts` — named-function path, no SDK instance.
- Update `CLAUDE.md` Architecture section: three-layer model, `compositions/` deprecation status.

### Step 7 — Mark `compositions/` as deprecated

- `@deprecated` JSDoc on each composition export pointing to the new resource path.
- Removal scheduled for a future major version. No code deletion in this work.

## Rejected alternatives

- **Auto-discovery via module side effects.** Self-registering resource files import-trigger their `registerExtension` call. Defeats tree-shaking (every imported file ships) and couples runtime behavior to import order.
- **Resource classes wrapping the route Proxy.** `class AppResource { constructor(routes) { ... } }`. More OO, more boilerplate, loses the dynamic route fallthrough that `create-client.ts` already provides for free. Also forces re-typing of every route method we want to expose.
- **`ctx` exposes only the current service's client.** Simpler types, but the cross-service `pg` flow can't be expressed — it needs both `addOnAttachment.resolution` (platform) and `database.info` (data).
- **`ctx` exposes the SDK root.** One handle, fully recursive. Couples every extension to the entire SDK rather than to specific services it needs. Recursive type bound is harder than the per-service approach.
- **Routes win on collision.** Silent override the other direction; same risk as "extensions win" but loses the wrap-a-route capability that's part of why extensions are valuable.
- **Throw at registration on collision.** Strictly safer; punishes the legitimate "wrap this route" use case.
- **Method-level tree-shaking.** Fundamentally incompatible with the `sdk.x.y.z()` shape. Bundlers can't prove individual property accesses unused.
- **`import * from '@heroku/sdk/extensions/platform'` everything-bundle.** `import *` defeats tree-shaking. Removed in favor of explicit named imports only.
- **Codegen extension bundle delegation.** Hand-written delegation is one line per method, reviewable, gives a place to add per-method behavior. Revisit if the manual layer becomes a maintenance pain.
- **Eagerly delete `compositions/`.** Breaks any consumer importing `@heroku/sdk/compositions/*`. Transitional alias keeps the surface available through the next major version.
