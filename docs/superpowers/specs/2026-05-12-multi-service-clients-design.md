# Multi-service clients for `@heroku/sdk`

## Background

`@heroku/sdk` currently exposes a single factory, `createHerokuClient`, that
binds the proxy-based dispatcher to the `3.sdk` (Platform API) routes and types
from `@heroku/types`. Upstream `@heroku/types` already declares subpath exports
for additional APIs (`./data`, with more to follow). The SDK needs to support
those services without forcing consumers to choose a service via a runtime
string, and without bundling routes for services they don't use.

The dispatcher and proxy in `src/core/` are already service-agnostic at
runtime. The only places `3.sdk` is hardcoded are the type and routes imports
in `src/core/create-client.ts`. That is the seam this design rebuilds around.

## Goals

- Support multiple Heroku APIs (Platform, Data, future services) in a single
  package.
- Keep client construction synchronous.
- Allow bundlers to exclude services the consumer does not import (browser /
  edge friendly).
- Preserve full type safety per service without conditional types keyed on a
  runtime argument.
- Keep the new-service-onboarding cost low: one file plus one `package.json`
  entry.

## Non-goals

- Backwards-compatibility shims for the existing `createHerokuClient`.
  There are no in-the-wild consumers to preserve.
- A single combined client that exposes every service under one root.
  The Platform and Data APIs are typically used in different contexts.
- Async / lazy-loading factories. Bundle-size benefits come from per-service
  entry points, not dynamic imports.
- Public exposure of the underlying generic primitive. The per-service
  factories are the entire public API; the primitive is internal.

## Design

### Public API

The package exposes one subpath per Heroku service. Each subpath exports a
sync factory and a re-exported client type:

```ts
// Platform API
import { createPlatformClient } from '@heroku/sdk/platform'
import type { PlatformClient } from '@heroku/sdk/platform'

const platform = createPlatformClient({ token: '...' })
await platform.app.list()

// Data API
import { createDataClient } from '@heroku/sdk/data'
import type { DataClient } from '@heroku/sdk/data'

const data = createDataClient({ token: '...' })

// Shared types (root)
import type { HerokuApiClientOptions } from '@heroku/sdk'
```

The root `@heroku/sdk` re-exports only `HerokuApiClientOptions` and contains
no factory. There is intentionally no service-agnostic entry point: any
default-service choice would re-introduce the configurability problem this
design rejects.

The upstream `@heroku/types/<service>` modules each export a `HerokuClient`
interface (the same name across subpaths). We rename at the SDK boundary to
`PlatformClient` and `DataClient` so consumers importing both subpaths into
one file do not collide.

### Internal architecture

The runtime engine is a generic, service-agnostic factory. Each per-service
file is a thin wrapper that pairs a service's routes registry with its
matching client type and binds the correct `service` identifier through to
`@heroku/api-client`.

```
@heroku/sdk
├── /platform   → createPlatformClient()  → @heroku/types/3.sdk{,/routes}
├── /data       → createDataClient()      → @heroku/types/data{,/routes}
└── (internal)  → createClient(routes, opts)  ← the engine
```

`@heroku/api-client` already owns service-to-`baseUrl` resolution via its
`HerokuService` union and internal `SERVICE_CONFIGS` registry. Each
per-service factory injects `service: '<name>'` as a default; user-supplied
`service` and `baseUrl` values still take precedence.

### File layout

```
src/
  index.ts                          # re-exports HerokuApiClientOptions only
  services/
    platform.ts                     # createPlatformClient + PlatformClient type
    data.ts                         # createDataClient + DataClient type
  core/
    create-client.ts                # generic createClient<T>(routes, opts): T
    create-client.test.ts
    dispatcher.ts                   # unchanged
    dispatcher.test.ts              # unchanged
    interpolate-path.ts             # unchanged
    interpolate-path.test.ts        # unchanged
```

### Per-service factory (example: `src/services/platform.ts`)

```ts
import type { HerokuApiClientOptions } from '@heroku/api-client'
import type { HerokuClient as PlatformClient } from '@heroku/types/3.sdk'

import * as routes from '@heroku/types/3.sdk/routes'

import { createClient } from '../core/create-client.js'

export type { PlatformClient }

export function createPlatformClient(options: HerokuApiClientOptions = {}): PlatformClient {
  return createClient<PlatformClient>(routes, { service: 'platform', ...options })
}
```

`src/services/data.ts` is the same shape with `'data'`, the `data` subpaths,
and the `DataClient` rename.

### Generic engine (`src/core/create-client.ts`)

```ts
import type { HerokuApiClientOptions } from '@heroku/api-client'
// type-only; identical structure across all services
import type { RouteDefinition } from '@heroku/types/3.sdk/routes'

import { HerokuApiClient } from '@heroku/api-client'

import { dispatch } from './dispatcher.js'

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

`createClient` is *not* exported from `src/index.ts` and has no subpath
export in `package.json`. It is reachable only by sibling files in
`src/services/`. This enforces internality structurally, which is stronger
than a `@internal` TSDoc tag.

The `RouteDefinition` import remains keyed to the `3.sdk` subpath until
upstream centralizes the type. The runtime route shape is generator-
controlled and identical across services, so this single import describes
all of them. The comment on the import line documents that fact.

### Root entry (`src/index.ts`)

```ts
export type { HerokuApiClientOptions } from '@heroku/api-client'
```

### Package exports (`package.json`)

```json
"exports": {
  ".": "./dist/index.js",
  "./platform": "./dist/services/platform.js",
  "./data": "./dist/services/data.js",
  "./compositions/*": "./dist/compositions/*.js"
}
```

### Adding a future service

1. Create `src/services/<name>.ts` mirroring the existing factories with the
   correct `@heroku/types/<subpath>` imports and a `service: '<name>'`
   default (the value must exist in `@heroku/api-client`'s `HerokuService`
   union).
2. Add `"./<name>": "./dist/services/<name>.js"` to `package.json` exports.
3. Add `src/services/<name>.test.ts` covering the wiring contract (see
   Testing).

No changes to `core/` are required.

## Testing

### `src/core/create-client.test.ts`

- Drop the `vi.mock('@heroku/types/3.sdk/routes', ...)` block. After the
  refactor, `createClient` accepts a routes module as a parameter, so tests
  pass an inline fake routes object instead of mocking the module.
- Keep the `vi.mock('@heroku/api-client', ...)` block; it still exercises
  the dispatch path through a fake HTTP client.
- The fake routes object is the same data the current mock factory returns,
  lifted into a local `const` and passed to `createClient<unknown>(fakeRoutes, opts)`.

This is strictly a simplification: fewer mocks, same coverage.

### `src/services/platform.test.ts` and `src/services/data.test.ts` (new)

Each verifies two contracts:

1. The factory forwards the correct `service` value to `HerokuApiClient`.
   Mock `@heroku/api-client` to capture constructor options, call the factory
   with no `service` argument, and assert `service: 'platform'` (or `'data'`)
   was passed.
2. A user-supplied `service` overrides the default. Same mock, call with
   `{ service: 'custom', baseUrl: '...' }`, assert the user's value wins.

These tests do not re-cover dispatch behavior — that lives in
`create-client.test.ts` and `dispatcher.test.ts`. They exist solely to lock
in the service-binding contract that this refactor specifically risks
breaking (e.g., a copy-paste error that puts `service: 'platform'` in
`data.ts`).

### Unchanged

`dispatcher.test.ts` and `interpolate-path.test.ts` require no modifications.

## Migration & rollout

Single PR, version bump `0.1.0 → 0.2.0`. The PR contains:

- Lift `createHerokuClient` → generic internal `createClient` in
  `src/core/create-client.ts`.
- Add `src/services/platform.ts` and `src/services/data.ts`.
- Update `src/index.ts` to re-export only `HerokuApiClientOptions`.
- Add `./platform` and `./data` subpath exports to `package.json`.
- Remove the old `createHerokuClient` and `HerokuClient` exports (no
  back-compat shim).
- Update tests per the Testing section.
- Update `examples/basic-usage.ts` to use `createPlatformClient`; flesh out
  `examples/data-usage.ts` to use `createDataClient`.
- Update `CLAUDE.md`'s "Project Layout" and "Architecture" sections to
  reflect the new structure.
- CHANGELOG entry calling out the breaking API change.

This PR ships only after `@heroku/types` publishes its `data/` subpath
payload. The `data.ts` factory references types and routes that do not yet
exist in the upstream package; landing the refactor without that payload
would require a stub we then have to remove.

## Deferred / out-of-scope

- **Upstream `RouteDefinition` centralization.** When `@heroku/types` lifts
  `RouteDefinition` to a shared (non-service) location, the import in
  `src/core/create-client.ts` and the accompanying comment can be updated.
  Cosmetic; non-blocking.
- **Upstream service-name metadata** (a per-subpath `serviceName` constant).
  Would let factories tag errors and telemetry without hardcoded strings.
  Not required.
- **Upstream subpath rename `3.sdk` → `platform`.** When this lands, the
  import in `src/services/platform.ts` becomes
  `from '@heroku/types/platform'` and the type rename is no longer needed.
- **`createParticleboardClient` and a `createCustomClient` escape hatch.**
  `@heroku/api-client`'s `HerokuService` union already includes
  `'particleboard'` and `'custom'`. Adding factories for these is purely
  additive (one file plus one export entry per service) and not required
  for this change.
