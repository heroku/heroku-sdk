# Multi-Service Clients Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single `createHerokuClient` factory with per-service factories (`createPlatformClient`, `createDataClient`) exposed via subpath exports, backed by an internal generic `createClient` engine.

**Architecture:** Lift the existing proxy-based factory into a service-agnostic generic that takes a routes module as a parameter. Add per-service files under `src/services/` that bind a service's routes + types to the generic engine and inject the matching `service` identifier for `@heroku/api-client`'s baseUrl resolution. Keep the generic primitive internal.

**Tech Stack:** TypeScript (ES2022, ESM, strict), vitest, `@heroku/api-client`, `@heroku/types` (subpath exports `./3.sdk` and `./data`).

**Spec:** `docs/superpowers/specs/2026-05-12-multi-service-clients-design.md`

---

### Task 1: Verify prerequisites and baseline

**Files:**
- Inspect: `node_modules/@heroku/types/data/`
- Inspect: `node_modules/@heroku/types/package.json`
- Run: existing test suite

The plan requires the upstream `@heroku/types` package to ship its `data/` subpath payload. The package.json declares `./data` and `./data/routes` exports, but the package may still ship only `3.sdk/`. Verify before proceeding.

- [ ] **Step 1: Verify the data subpath is available in node_modules**

Run: `ls node_modules/@heroku/types/data/`
Expected: directory exists and contains `routes.js`, `routes.d.ts`, `types.d.ts`.

If the directory does not exist, **STOP**. Do not proceed with this plan. Either:
- Bump `@heroku/types` to a version that ships `data/`, then re-run this step.
- Or run only the platform-related tasks (Tasks 2, 3, 5, 6, 7, 8, 9, 10) and skip Task 4 plus the data references in Tasks 6, 8 and 9 — but only if the user explicitly authorizes splitting the rollout.

- [ ] **Step 2: Confirm baseline tests pass**

Run: `npm test`
Expected: all tests pass.

- [ ] **Step 3: No commit**

This task makes no source changes.

---

### Task 2: Add the generic `createClient` engine alongside the existing factory

**Files:**
- Modify: `src/core/create-client.ts`
- Modify: `src/core/create-client.test.ts`

This task introduces the new generic engine without removing the old `createHerokuClient`. Keeping both temporarily lets the rest of the codebase compile through the migration. The old factory is removed in Task 7 once all consumers have migrated.

- [ ] **Step 1: Add a new failing test for `createClient`**

Append to `src/core/create-client.test.ts`, after the existing `describe('createHerokuClient', ...)` block:

```typescript
import {createClient} from './create-client.js'

const fakeRoutes = {
  accountFeature: {
    update: {hasRequestBody: true, method: 'PATCH', path: '/account/features/{accountFeatureIdentity}'},
  },
  app: {
    create: {hasRequestBody: true, method: 'POST', path: '/apps'},
    delete: {method: 'DELETE', path: '/apps/{appIdentity}'},
    info: {method: 'GET', path: '/apps/{appIdentity}'},
    list: {method: 'GET', path: '/apps'},
  },
}

describe('createClient', () => {
  it('returns an object with resource namespaces matching the supplied routes', () => {
    const client = createClient<any>(fakeRoutes, {token: 'test-token'})
    expect(client.app).toBeDefined()
    expect(client.accountFeature).toBeDefined()
  })

  it('returns undefined for unknown resource keys', () => {
    const client = createClient<any>(fakeRoutes, {token: 'test-token'})
    expect(client.nonExistent).toBeUndefined()
  })

  it('returns undefined for unknown method keys', () => {
    const client = createClient<any>(fakeRoutes, {token: 'test-token'})
    expect(client.app.nonExistent).toBeUndefined()
  })

  it('dispatches list call as GET to correct path', async () => {
    const client = createClient<any>(fakeRoutes, {token: 'test-token'})
    const result = await client.app.list()
    expect(result).toEqual([{id: '1', name: 'my-app'}])
  })

  it('dispatches create call as POST with body', async () => {
    const client = createClient<any>(fakeRoutes, {token: 'test-token'})
    const result = await client.app.create({name: 'new-app'})
    expect(result).toEqual({id: '2', name: 'new-app'})
  })
})
```

Note: the new tests bypass the existing `vi.mock('@heroku/types/3.sdk/routes', ...)` block by passing routes directly. The mock can stay in place for now; it's used by the existing `createHerokuClient` tests and is removed in Task 7.

- [ ] **Step 2: Run the new tests and verify they fail**

Run: `npm test -- src/core/create-client.test.ts`
Expected: the new `describe('createClient', ...)` block fails with errors like `createClient is not a function` or `Cannot find name 'createClient'`. The pre-existing `describe('createHerokuClient', ...)` block continues to pass.

- [ ] **Step 3: Implement the generic `createClient` alongside `createHerokuClient`**

Replace the contents of `src/core/create-client.ts` with:

```typescript
import type {HerokuApiClientOptions} from '@heroku/api-client'
import type {HerokuClient} from '@heroku/types/3.sdk'
// type-only; identical structure across all services
import type {RouteDefinition} from '@heroku/types/3.sdk/routes'

import {HerokuApiClient} from '@heroku/api-client'
import * as routes from '@heroku/types/3.sdk/routes'

import {dispatch} from './dispatcher.js'

type RoutesModule = Record<string, Record<string, RouteDefinition>>

export function createClient<T>(routesModule: RoutesModule, options: HerokuApiClientOptions = {}): T {
  const httpClient = new HerokuApiClient(options)

  return new Proxy({} as T, {
    get(_target, resourceKey: string) {
      if (!Object.hasOwn(routesModule, resourceKey)) return
      const resourceRoutes = routesModule[resourceKey]

      return new Proxy({}, {
        get(_t, methodKey: string) {
          const route = resourceRoutes[methodKey]
          if (!route) return
          return (...args: unknown[]) => dispatch(httpClient, route, args)
        },
      })
    },
  })
}

export function createHerokuClient(options: HerokuApiClientOptions = {}): HerokuClient {
  return createClient<HerokuClient>(routes, options)
}
```

The old `createHerokuClient` is rewritten to delegate to `createClient`, preserving its existing behavior and signature. This keeps `src/index.ts` and `src/compositions/promote-pipeline.ts` working until they're migrated in Tasks 5 and 7.

- [ ] **Step 4: Run all tests and verify they pass**

Run: `npm test`
Expected: all tests pass — both the new `createClient` block and the existing `createHerokuClient` block.

- [ ] **Step 5: Commit**

```bash
git add src/core/create-client.ts src/core/create-client.test.ts
git commit -m "$(cat <<'EOF'
refactor(core): add generic createClient engine

Adds a service-agnostic createClient<T>(routes, opts) primitive that takes
a routes module as a parameter. createHerokuClient now delegates to it.
This is the seam for upcoming per-service factories.
EOF
)"
```

---

### Task 3: Add platform service factory

**Files:**
- Create: `src/services/platform.ts`
- Create: `src/services/platform.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/services/platform.test.ts`:

```typescript
import {describe, expect, it, vi} from 'vitest'

const constructorSpy = vi.fn()

vi.mock('@heroku/api-client', () => ({
  HerokuApiClient: class {
    constructor(options: unknown) {
      constructorSpy(options)
    }
  },
}))

vi.mock('@heroku/types/3.sdk/routes', () => ({
  app: {
    list: {method: 'GET', path: '/apps'},
  },
}))

describe('createPlatformClient', () => {
  it("forwards service: 'platform' by default", async () => {
    constructorSpy.mockClear()
    const {createPlatformClient} = await import('./platform.js')

    createPlatformClient({token: 'test-token'})

    expect(constructorSpy).toHaveBeenCalledWith(
      expect.objectContaining({service: 'platform', token: 'test-token'}),
    )
  })

  it('lets a user-supplied service override the default', async () => {
    constructorSpy.mockClear()
    const {createPlatformClient} = await import('./platform.js')

    createPlatformClient({service: 'custom', baseUrl: 'https://example.test', token: 'test-token'})

    expect(constructorSpy).toHaveBeenCalledWith(
      expect.objectContaining({service: 'custom', baseUrl: 'https://example.test'}),
    )
  })
})
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `npm test -- src/services/platform.test.ts`
Expected: failure with `Cannot find module './platform.js'` or equivalent.

- [ ] **Step 3: Create the platform factory**

Create `src/services/platform.ts`:

```typescript
import type {HerokuApiClientOptions} from '@heroku/api-client'
import type {HerokuClient as PlatformClient} from '@heroku/types/3.sdk'

import * as routes from '@heroku/types/3.sdk/routes'

import {createClient} from '../core/create-client.js'

export type {PlatformClient}

export function createPlatformClient(options: HerokuApiClientOptions = {}): PlatformClient {
  return createClient<PlatformClient>(routes, {service: 'platform', ...options})
}
```

- [ ] **Step 4: Run the test and verify it passes**

Run: `npm test -- src/services/platform.test.ts`
Expected: both tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/services/platform.ts src/services/platform.test.ts
git commit -m "$(cat <<'EOF'
feat(services): add createPlatformClient factory

Per-service factory for the Heroku Platform API. Binds 3.sdk routes and
types to the generic createClient engine and injects service: 'platform'
so @heroku/api-client resolves the correct baseUrl.
EOF
)"
```

---

### Task 4: Add data service factory

**Files:**
- Create: `src/services/data.ts`
- Create: `src/services/data.test.ts`

This task depends on `@heroku/types/data` being available (verified in Task 1, Step 1).

- [ ] **Step 1: Write the failing test**

Create `src/services/data.test.ts`:

```typescript
import {describe, expect, it, vi} from 'vitest'

const constructorSpy = vi.fn()

vi.mock('@heroku/api-client', () => ({
  HerokuApiClient: class {
    constructor(options: unknown) {
      constructorSpy(options)
    }
  },
}))

vi.mock('@heroku/types/data/routes', () => ({
  addon: {
    list: {method: 'GET', path: '/addons'},
  },
}))

describe('createDataClient', () => {
  it("forwards service: 'data' by default", async () => {
    constructorSpy.mockClear()
    const {createDataClient} = await import('./data.js')

    createDataClient({token: 'test-token'})

    expect(constructorSpy).toHaveBeenCalledWith(
      expect.objectContaining({service: 'data', token: 'test-token'}),
    )
  })

  it('lets a user-supplied service override the default', async () => {
    constructorSpy.mockClear()
    const {createDataClient} = await import('./data.js')

    createDataClient({service: 'custom', baseUrl: 'https://example.test', token: 'test-token'})

    expect(constructorSpy).toHaveBeenCalledWith(
      expect.objectContaining({service: 'custom', baseUrl: 'https://example.test'}),
    )
  })
})
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `npm test -- src/services/data.test.ts`
Expected: failure with `Cannot find module './data.js'`.

- [ ] **Step 3: Create the data factory**

Create `src/services/data.ts`:

```typescript
import type {HerokuApiClientOptions} from '@heroku/api-client'
import type {HerokuClient as DataClient} from '@heroku/types/data'

import * as routes from '@heroku/types/data/routes'

import {createClient} from '../core/create-client.js'

export type {DataClient}

export function createDataClient(options: HerokuApiClientOptions = {}): DataClient {
  return createClient<DataClient>(routes, {service: 'data', ...options})
}
```

- [ ] **Step 4: Run the test and verify it passes**

Run: `npm test -- src/services/data.test.ts`
Expected: both tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/services/data.ts src/services/data.test.ts
git commit -m "$(cat <<'EOF'
feat(services): add createDataClient factory

Per-service factory for the Heroku Data API. Mirrors the platform factory
shape, binding @heroku/types/data routes and types to the generic engine
with service: 'data'.
EOF
)"
```

---

### Task 5: Migrate the `promotePipeline` composition to use `createPlatformClient`

**Files:**
- Modify: `src/compositions/promote-pipeline.ts`
- Modify: `src/compositions/promote-pipeline.test.ts`

`promotePipeline` calls Platform API endpoints (`pipelinePromotion`, `pipelinePromotionTarget`), so it migrates to `createPlatformClient`.

- [ ] **Step 1: Update the composition test to mock the platform service module**

Replace `src/compositions/promote-pipeline.test.ts` lines 7-12 (the import and `vi.mock` block):

Before:
```typescript
import {createHerokuClient} from '../core/create-client.js'
import {promotePipeline} from './promote-pipeline.js'

vi.mock('../core/create-client.js', () => ({
  createHerokuClient: vi.fn(),
}))
```

After:
```typescript
import {createPlatformClient} from '../services/platform.js'
import {promotePipeline} from './promote-pipeline.js'

vi.mock('../services/platform.js', () => ({
  createPlatformClient: vi.fn(),
}))
```

Then in the same file, replace every occurrence of `vi.mocked(createHerokuClient)` with `vi.mocked(createPlatformClient)`. There are seven occurrences (lines 55, 78, 95, 105, 114, 129, 146 in the original file).

Also replace the test name on the original line 142 from:
```typescript
it('forwards clientOptions to createHerokuClient', async () => {
```
to:
```typescript
it('forwards clientOptions to createPlatformClient', async () => {
```

And the assertion on the original line 150:
```typescript
expect(createHerokuClient).toHaveBeenCalledWith({token: 'abc'})
```
becomes:
```typescript
expect(createPlatformClient).toHaveBeenCalledWith({token: 'abc'})
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `npm test -- src/compositions/promote-pipeline.test.ts`
Expected: failure — the implementation still imports `createHerokuClient`, so the mocked `createPlatformClient` is never called and the spy assertions fail.

- [ ] **Step 3: Update the composition to import `createPlatformClient`**

In `src/compositions/promote-pipeline.ts`:

Replace line 8:
```typescript
import {createHerokuClient} from '../core/create-client.js'
```
with:
```typescript
import {createPlatformClient} from '../services/platform.js'
```

Replace line 35:
```typescript
const client = createHerokuClient(clientOptions)
```
with:
```typescript
const client = createPlatformClient(clientOptions)
```

- [ ] **Step 4: Run the test and verify it passes**

Run: `npm test -- src/compositions/promote-pipeline.test.ts`
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/compositions/promote-pipeline.ts src/compositions/promote-pipeline.test.ts
git commit -m "$(cat <<'EOF'
refactor(compositions): migrate promotePipeline to createPlatformClient

Pipeline promotion is a Platform API operation, so it moves to the
explicit per-service factory. No behavior change.
EOF
)"
```

---

### Task 6: Update examples

**Files:**
- Modify: `examples/basic-usage.ts`
- Modify: `examples/data-usage.ts`

- [ ] **Step 1: Update `examples/basic-usage.ts`**

Replace the entire file contents with:

```typescript
import {createPlatformClient} from '../src/services/platform.js'

// Create a client — automatically reads token from HEROKU_API_KEY or ~/.netrc
const heroku = createPlatformClient()

// List all apps
const apps = await heroku.app.list()
console.log(`Found ${apps.length} apps`)

const [lastApp] = apps.slice(-1)

// Get a specific app
const app = await heroku.app.info(lastApp.name!)
console.log(`App: ${app.name} (${app.id})`)
```

- [ ] **Step 2: Update `examples/data-usage.ts`**

Replace the entire file contents with:

```typescript
import {createDataClient} from '../src/services/data.js'

// Create a client — automatically reads token from HEROKU_API_KEY or ~/.netrc
// const data = createDataClient()

// const addons = await data.addon.list()
// console.log(`Found ${addons.length} data add-ons`)
```

(The body remains commented out, mirroring the placeholder shape the user already has on disk. The point of this file is the import line being correct.)

- [ ] **Step 3: Verify the project still builds**

Run: `npm run build`
Expected: clean compile, no errors. (Examples are excluded from `tsconfig.json`'s `include`, so they don't gate the build, but they should still reference real exports.)

- [ ] **Step 4: Commit**

```bash
git add examples/basic-usage.ts examples/data-usage.ts
git commit -m "$(cat <<'EOF'
docs(examples): switch examples to per-service factories

basic-usage uses createPlatformClient; data-usage uses createDataClient.
EOF
)"
```

---

### Task 7: Remove the old `createHerokuClient` factory and its tests

**Files:**
- Modify: `src/core/create-client.ts`
- Modify: `src/core/create-client.test.ts`

All consumers have migrated. Remove the deprecated factory and its co-located tests, plus the now-unneeded `vi.mock('@heroku/types/3.sdk/routes', ...)` block.

- [ ] **Step 1: Trim `src/core/create-client.test.ts`**

Replace the entire file contents with:

```typescript
import {describe, expect, it, vi} from 'vitest'

import {createClient} from './create-client.js'

function mockResponse(body: unknown, status = 200): Response {
  return {
    headers: new Headers({'content-length': '100'}),
    json: () => Promise.resolve(body),
    status,
  } as unknown as Response
}

vi.mock('@heroku/api-client', () => ({
  HerokuApiClient: class {
    delete = vi.fn().mockResolvedValue(mockResponse({id: '1'}))
    get = vi.fn().mockResolvedValue(mockResponse([{id: '1', name: 'my-app'}]))
    patch = vi.fn().mockResolvedValue(mockResponse({id: '1', name: 'updated'}))
    post = vi.fn().mockResolvedValue(mockResponse({id: '2', name: 'new-app'}, 201))
  },
}))

const fakeRoutes = {
  accountFeature: {
    update: {hasRequestBody: true, method: 'PATCH', path: '/account/features/{accountFeatureIdentity}'},
  },
  app: {
    create: {hasRequestBody: true, method: 'POST', path: '/apps'},
    delete: {method: 'DELETE', path: '/apps/{appIdentity}'},
    info: {method: 'GET', path: '/apps/{appIdentity}'},
    list: {method: 'GET', path: '/apps'},
  },
}

describe('createClient', () => {
  it('returns an object with resource namespaces matching the supplied routes', () => {
    const client = createClient<any>(fakeRoutes, {token: 'test-token'})
    expect(client.app).toBeDefined()
    expect(client.accountFeature).toBeDefined()
  })

  it('returns undefined for unknown resource keys', () => {
    const client = createClient<any>(fakeRoutes, {token: 'test-token'})
    expect(client.nonExistent).toBeUndefined()
  })

  it('returns undefined for unknown method keys', () => {
    const client = createClient<any>(fakeRoutes, {token: 'test-token'})
    expect(client.app.nonExistent).toBeUndefined()
  })

  it('dispatches list call as GET to correct path', async () => {
    const client = createClient<any>(fakeRoutes, {token: 'test-token'})
    const result = await client.app.list()
    expect(result).toEqual([{id: '1', name: 'my-app'}])
  })

  it('dispatches create call as POST with body', async () => {
    const client = createClient<any>(fakeRoutes, {token: 'test-token'})
    const result = await client.app.create({name: 'new-app'})
    expect(result).toEqual({id: '2', name: 'new-app'})
  })

  it('dispatches info call with path parameter', async () => {
    const client = createClient<any>(fakeRoutes, {token: 'test-token'})
    const result = await client.app.info('my-app')
    expect(result).toEqual([{id: '1', name: 'my-app'}])
  })

  it('dispatches update call with path param and body', async () => {
    const client = createClient<any>(fakeRoutes, {token: 'test-token'})
    const result = await client.accountFeature.update('my-feature', {enabled: true})
    expect(result).toEqual({id: '1', name: 'updated'})
  })
})
```

The `@heroku/types/3.sdk/routes` `vi.mock` block is gone because routes are passed as a parameter now.

- [ ] **Step 2: Trim `src/core/create-client.ts`**

Replace the entire file contents with:

```typescript
import type {HerokuApiClientOptions} from '@heroku/api-client'
// type-only; identical structure across all services
import type {RouteDefinition} from '@heroku/types/3.sdk/routes'

import {HerokuApiClient} from '@heroku/api-client'

import {dispatch} from './dispatcher.js'

type RoutesModule = Record<string, Record<string, RouteDefinition>>

export function createClient<T>(routes: RoutesModule, options: HerokuApiClientOptions = {}): T {
  const httpClient = new HerokuApiClient(options)

  return new Proxy({} as T, {
    get(_target, resourceKey: string) {
      if (!Object.hasOwn(routes, resourceKey)) return
      const resourceRoutes = routes[resourceKey]

      return new Proxy({}, {
        get(_t, methodKey: string) {
          const route = resourceRoutes[methodKey]
          if (!route) return
          return (...args: unknown[]) => dispatch(httpClient, route, args)
        },
      })
    },
  })
}
```

The `HerokuClient` type import, the `routes` value import, and the `createHerokuClient` function are all gone. The parameter is renamed from `routesModule` back to `routes` for clarity now that there's no name collision with the value-import.

- [ ] **Step 3: Run all tests and verify they pass**

Run: `npm test`
Expected: all tests pass. The full suite (dispatcher, interpolate-path, create-client, services/platform, services/data, compositions/promote-pipeline) should be green.

- [ ] **Step 4: Run the build to confirm no stale references**

Run: `npm run build`
Expected: clean compile.

- [ ] **Step 5: Commit**

```bash
git add src/core/create-client.ts src/core/create-client.test.ts
git commit -m "$(cat <<'EOF'
refactor(core): drop createHerokuClient

All consumers (compositions, examples, future SDK entry points) have
migrated to the per-service factories. The generic createClient is now
the only export from core/create-client.ts.
EOF
)"
```

---

### Task 8: Trim `src/index.ts` to only the shared types

**Files:**
- Modify: `src/index.ts`

- [ ] **Step 1: Replace `src/index.ts` contents**

Replace the entire file with:

```typescript
export type {HerokuApiClientOptions} from '@heroku/api-client'
```

The two old exports (`createHerokuClient` from `./core/create-client.js` and `HerokuClient` from `@heroku/types/3.sdk`) are gone. The root entry now only re-exports the shared, service-independent options type.

- [ ] **Step 2: Run all tests and the build**

Run: `npm test && npm run build`
Expected: both succeed.

- [ ] **Step 3: Commit**

```bash
git add src/index.ts
git commit -m "$(cat <<'EOF'
refactor(index): drop createHerokuClient and HerokuClient root exports

The root entry now only re-exports HerokuApiClientOptions. Service-bound
factories and types are reachable via the @heroku/sdk/platform and
@heroku/sdk/data subpaths.
EOF
)"
```

---

### Task 9: Add subpath exports to `package.json`

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Update the `exports` map**

In `package.json`, replace the existing `exports` block:

Before:
```json
"exports": {
  ".": "./dist/index.js",
  "./compositions/*": "./dist/compositions/*.js"
},
```

After:
```json
"exports": {
  ".": "./dist/index.js",
  "./platform": "./dist/services/platform.js",
  "./data": "./dist/services/data.js",
  "./compositions/*": "./dist/compositions/*.js"
},
```

- [ ] **Step 2: Build and verify the dist artifacts exist**

Run: `npm run build && ls dist/services/`
Expected: `dist/services/` contains `platform.js`, `platform.d.ts`, `data.js`, `data.d.ts`.

- [ ] **Step 3: Run tests**

Run: `npm test`
Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git add package.json
git commit -m "$(cat <<'EOF'
build(pkg): expose ./platform and ./data subpath exports

Consumers import per-service factories via @heroku/sdk/platform and
@heroku/sdk/data. The root @heroku/sdk only exports shared types.
EOF
)"
```

---

### Task 10: Update `CLAUDE.md`, version, and CHANGELOG

**Files:**
- Modify: `CLAUDE.md`
- Modify: `package.json`
- Create: `CHANGELOG.md` (if not already present)

- [ ] **Step 1: Update `CLAUDE.md`**

Replace the entire file contents with:

```markdown
# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```sh
npm test              # run all tests (vitest --run)
npm test -- src/core/dispatcher.test.ts   # run a single test file
npm run build         # compile TypeScript to dist/
npm run example -- examples/basic-usage.ts  # run an example with tsx
```

## Project Layout

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
    *.test.ts                      # co-located vitest tests
  compositions/
    promote-pipeline.ts            # multi-call workflow built on createPlatformClient
examples/
  basic-usage.ts                   # platform usage example (npm run example)
  data-usage.ts                    # data usage example
```

## Architecture

This is the Heroku SDK (`@heroku/sdk`). It generates fully-typed clients at runtime from route definitions — no hand-written method per endpoint. The package exposes one factory per Heroku service via subpath exports.

**Public surface:**
- `@heroku/sdk/platform` → `createPlatformClient`, `PlatformClient`
- `@heroku/sdk/data` → `createDataClient`, `DataClient`
- `@heroku/sdk` (root) → `HerokuApiClientOptions` (shared types only)

**Per-service factories:** Each `src/services/<name>.ts` is a thin wrapper that imports its service's routes and types from `@heroku/types/<subpath>`, delegates to the internal `createClient` engine, and injects the matching `service` identifier so `@heroku/api-client` resolves the correct baseUrl.

**Generic engine (`createClient`)** is internal — reachable only by sibling files in `src/services/`. It returns a nested Proxy: the outer proxy resolves resource names (e.g., `client.app`), the inner proxy resolves methods (e.g., `.list()`, `.info()`). Both look up keys against the routes registry passed as a parameter. Unknown keys return `undefined`.

**Argument convention:** Dispatch arguments are positional — path parameters come first (matched to `{placeholder}` segments in the route path), followed by an optional request body if `route.hasRequestBody` is true. `interpolatePath` handles substitution with `encodeURIComponent`.

**Response handling:** `dispatch` delegates to a private `callMethod` switch that maps the route's HTTP method string to the corresponding `HerokuApiClient` method (get/post/put/patch/delete). Responses with status 204 or `content-length: 0` return `undefined`; all others are parsed as JSON.

**Adding a new service:** Create `src/services/<name>.ts` mirroring the existing factories with the correct `@heroku/types/<subpath>` imports and a `service: '<name>'` default. Add `"./<name>": "./dist/services/<name>.js"` to `package.json` exports. Add a `*.test.ts` covering the wiring contract. No changes to `core/` are needed.

**Key external dependencies:**
- `@heroku/api-client` (GitHub: `heroku/heroku-fetch`) — HTTP client (`HerokuApiClient`) that owns service-to-baseUrl resolution (`HerokuService` union, `SERVICE_CONFIGS` registry), auth (HEROKU_API_KEY / .netrc), headers, and raw fetch calls.
- `@heroku/types` (GitHub: `heroku/heroku-types`) — TypeScript types and route definition registries for each Heroku API, exposed via subpaths (`./3.sdk`, `./data`, more to come).

**Module format:** ESM throughout (`"type": "module"` in package.json). Internal imports use `.js` extensions (TypeScript requires this for ESM emit). Target is ES2022.

## Testing

Tests use vitest. Co-located `.test.ts` files. Each test file mocks `@heroku/api-client` (and, for service-factory tests, asserts on the constructor options to lock in the `service` wiring). The generic `createClient` test passes a fake routes object directly — no module mock needed.
```

- [ ] **Step 2: Bump the version in `package.json`**

Replace:
```json
"version": "0.1.0",
```
with:
```json
"version": "0.2.0",
```

- [ ] **Step 3: Create `CHANGELOG.md`**

Run: `ls CHANGELOG.md 2>/dev/null && echo exists || echo missing`

If it reports `missing`, create `CHANGELOG.md` with these contents:

```markdown
# Changelog

All notable changes to `@heroku/sdk` will be documented in this file.

## 0.2.0

### Breaking changes

- Removed `createHerokuClient` and the `HerokuClient` type from the root export. Consumers now import per-service factories from subpaths.
- The root `@heroku/sdk` entry now exports only `HerokuApiClientOptions`.

### Added

- `@heroku/sdk/platform` — `createPlatformClient(options)` and the `PlatformClient` type for the Heroku Platform API.
- `@heroku/sdk/data` — `createDataClient(options)` and the `DataClient` type for the Heroku Data API.

### Migration

```diff
- import { createHerokuClient } from '@heroku/sdk'
+ import { createPlatformClient } from '@heroku/sdk/platform'

- const heroku = createHerokuClient({ token: '...' })
+ const heroku = createPlatformClient({ token: '...' })
```
```

If `CHANGELOG.md` already exists, prepend the `## 0.2.0` section above the existing top-most entry.

- [ ] **Step 4: Final verification**

Run: `npm test && npm run build`
Expected: both succeed.

- [ ] **Step 5: Commit**

```bash
git add CLAUDE.md package.json CHANGELOG.md
git commit -m "$(cat <<'EOF'
chore: bump to 0.2.0; update CLAUDE.md and changelog

Documents the per-service factory architecture and records the breaking
removal of createHerokuClient.
EOF
)"
```

---

## Done criteria

When all tasks are complete:

1. `npm test` and `npm run build` both pass.
2. `git log --oneline` shows one commit per task (Tasks 2-10), stacked on `tl/data-example`.
3. The package exports `@heroku/sdk/platform`, `@heroku/sdk/data`, and `@heroku/sdk` (types-only), with no `createHerokuClient` reachable from anywhere.
4. `CLAUDE.md` reflects the new layout. `CHANGELOG.md` records the 0.2.0 release.
