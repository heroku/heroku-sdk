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
