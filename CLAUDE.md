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
    extend-resource.ts             # extendResource + ResourceCtx + type utilities
    extensions-proxy.ts            # mergeExtensions Proxy
    heroku-sdk.ts                  # HerokuSDK class (generic in Exts)
    *.test.ts                      # co-located vitest tests
  resources/
    extensions/
      platform.ts                  # curated public barrel of platform extensions
      data.ts                      # curated public barrel of data extensions
    platform/                      # one subdir per service
      shield.ts                    # single-file form (utility-only resource)
      app/                         # directory form (multi-method resource)
        index.ts                   # barrel + appExtensions bundle
        info.ts                    # one file per public method
        info.test.ts
        index.test.ts
      add-on/                      # directory form with shared types/errors
        index.ts
        types.ts                   # shared option/result types
        errors.ts                  # custom error classes
        <verb>.ts ...              # one file per public method
      pipeline/
        index.ts                   # pipelineExtensions
        coupling.ts                # pipelineCouplingExtensions
        promotion.ts               # pipelinePromotionExtensions
    data/
      maintenance.ts               # single-file form
      postgres-database.ts         # single-file form
      database.ts                  # single-file form (will graduate to dir as it grows)
      internal/                    # private helpers — NOT re-exported publicly
        resolve-pg-database.ts     # shared add-on resolver for pg flows
  utils/
    wait.ts                        # generic poll-with-backoff helper
examples/                          # runnable scripts via `npm run example -- <path>`
  basic-usage.ts                   # platform client
  data-usage.ts                    # data client
  sdk-usage.ts                     # HerokuSDK + extensions
  sdk-tree-shaken.ts               # named-function path (smallest bundle)
  abort-signal.ts, dyno.ts, logs.ts, pg.ts, pg-upgrade.ts,
  list-pipeline-apps.ts, promote-pipeline.ts
```

## Architecture

This is the Heroku SDK (`@heroku/sdk`). It generates fully-typed clients at runtime from route definitions — no hand-written method per endpoint. The package exposes one factory per Heroku service via subpath exports.

**Public surface:**
- `@heroku/sdk/platform` → `createPlatformClient`, `PlatformClient`
- `@heroku/sdk/data` → `createDataClient`, `DataClient`
- `@heroku/sdk` (root) → `HerokuApiClientOptions` (shared types only)

**SDK class (`@heroku/sdk` → `HerokuSDK`):** Combines per-service clients with hand-written resource extensions. Lazy per-service getters return Proxy-merged views: `sdk.platform.app.enableMaintenance()` is a hand-written method, `sdk.platform.app.info()` is the upstream route, both available on the same namespace. Extension bundles are imported by name from `@heroku/sdk/extensions/<service>` and passed at construction.

**Resource modules (`src/resources/<service>/<resource>[.ts | /index.ts]`):** Each resource module exports both tree-shakable named functions (callable with explicit `ctx`) and an `*Extensions` bundle produced by `extendResource`. The bundle is mechanical delegation — every method delegates one-line into the corresponding named function. Cross-service helpers (e.g., the pg flow that needs both platform and data clients) destructure both services from `ctx`. Single-method resources live in a single `<resource>.ts`; resources with multiple methods or per-method types/errors are promoted to a `<resource>/` directory with `index.ts` plus one `<verb>.ts` per public method.

**Per-service factories:** Each `src/services/<name>.ts` is a thin wrapper that imports its service's routes and types from `@heroku/types/<subpath>`, delegates to the internal `createClient` engine, and injects the matching `service` identifier so `@heroku/api-client` resolves the correct baseUrl.

**Generic engine (`createClient`)** is internal — reachable only by sibling files in `src/services/`. It returns a nested Proxy: the outer proxy resolves resource names (e.g., `client.app`), the inner proxy resolves methods (e.g., `.list()`, `.info()`). Both look up keys against the routes registry passed as a parameter. Unknown keys return `undefined`.

**Argument convention:** Dispatch arguments are positional — path parameters come first (matched to `{placeholder}` segments in the route path), followed by an optional request body if `route.hasRequestBody` is true. `interpolatePath` handles substitution with `encodeURIComponent`.

**Response handling:** `dispatch` delegates to a private `callMethod` switch that maps the route's HTTP method string to the corresponding `HerokuApiClient` method (get/post/put/patch/delete). Responses with status 204 or `content-length: 0` return `undefined`; all others are parsed as JSON. For GET requests returning an array, `dispatch` auto-paginates by following `next-range` response headers until all pages are collected. Callers opt out of auto-pagination by supplying their own `Range` header (via `withHeaders` or `requestOptions`).

**Adding a new service:** Create `src/services/<name>.ts` mirroring the existing factories with the correct `@heroku/types/<subpath>` imports and a `service: '<name>'` default. Add `"./<name>": "./dist/services/<name>.js"` to `package.json` exports. Add a `*.test.ts` covering the wiring contract. No changes to `core/` are needed.

**Resource module conventions:**
- Directory/file names are **kebab-case** (`add-on`, `postgres-database`); the `resource` argument to `extendResource` is the **camelCase** route key on the client (`'addOn'`, `'postgresDatabase'`) — it must match exactly so the Proxy merge replaces (rather than shadows) the upstream method.
- Every public function takes `ctx` first and `options` last with a default of `{}`. `options` always includes `signal?: AbortSignal`, and the function's first line is `options.signal?.throwIfAborted()`. Plumb the signal into the client via `ctx.<service>.withOptions({signal})` (or `withHeaders` when only headers need to change).
- Argument order is **path params → body → options**, mirroring the dispatcher's positional convention.
- The `extendResource` factory is **mechanical delegation only** — one line per method, no inline logic. Method names on the bundle are the ergonomic names callers see (`describe`, `resolve`), independent of the named function name (`describeAddon`, `resolveAddon`).
- Two-layer public surface: re-export every public function/type/error from the resource's `index.ts` (or single file), then add the `*Extensions` bundle and any utilities you want consumers to reach to `src/resources/extensions/<service>.ts`. That barrel *is* the `@heroku/sdk/extensions/<service>` contract — anything not listed there is internal.
- Put cross-resource helpers in `src/resources/<service>/internal/` and never re-export them from the service barrel.
- When `@heroku/types` types the client too loosely, declare a local `<Resource>DataClient` / `<Resource>Ctx` covering only what you use and bridge inside the factory: `const ctx = rawCtx as unknown as <Resource>Ctx` (see `src/resources/data/database.ts`).

**Key external dependencies:**
- `@heroku/api-client` (GitHub: `heroku/heroku-fetch`) — HTTP client (`HerokuApiClient`) that owns service-to-baseUrl resolution (`HerokuService` union, `SERVICE_CONFIGS` registry), auth (HEROKU_API_KEY / .netrc), headers, and raw fetch calls.
- `@heroku/types` (GitHub: `heroku/heroku-types`) — TypeScript types and route definition registries for each Heroku API, exposed via subpaths (`./3.sdk`, `./data`, more to come).

**Module format:** ESM throughout (`"type": "module"` in package.json). Internal imports use `.js` extensions (TypeScript requires this for ESM emit). Target is ES2022.

## Testing

Tests use vitest. Co-located `.test.ts` files. Each test file mocks `@heroku/api-client` (and, for service-factory tests, asserts on the constructor options to lock in the `service` wiring). The generic `createClient` test passes a fake routes object directly — no module mock needed.
