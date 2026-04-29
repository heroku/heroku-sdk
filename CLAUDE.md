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
  index.ts                         # public API — re-exports createHerokuClient, HerokuClient, HerokuApiClientOptions
  core/
    create-client.ts               # proxy-based client factory
    dispatcher.ts                  # route → HTTP call mapping
    interpolate-path.ts            # {placeholder} substitution
    *.test.ts                      # co-located vitest tests
examples/
  basic-usage.ts                   # runnable usage example (npm run example)
```

## Architecture

This is the Heroku Platform API SDK (`@heroku/sdk`). It generates a fully-typed client at runtime from route definitions — no hand-written method per endpoint.

**Proxy-based dynamic dispatch:** `createHerokuClient()` returns a nested Proxy. The outer proxy resolves resource names (e.g., `client.app`), the inner proxy resolves methods (e.g., `.list()`, `.info()`). Both look up keys against the route registry exported from `@heroku/types/3.sdk/routes`. Unknown keys return `undefined`.

**Argument convention:** Dispatch arguments are positional — path parameters come first (matched to `{placeholder}` segments in the route path), followed by an optional request body if `route.hasRequestBody` is true. `interpolatePath` handles substitution with `encodeURIComponent`.

**Response handling:** `dispatch` delegates to a private `callMethod` switch that maps the route's HTTP method string to the corresponding `HerokuApiClient` method (get/post/put/patch/delete). Responses with status 204 or `content-length: 0` return `undefined`; all others are parsed as JSON.

**Key external dependencies:**
- `@heroku/api-client` (GitHub: `heroku/heroku-fetch`) — HTTP client (`HerokuApiClient`) that handles auth (HEROKU_API_KEY / .netrc), headers, and raw fetch calls
- `@heroku/types` (GitHub: `heroku/heroku-types`) — TypeScript types for the Heroku API and the route definition registry (`RouteDefinition`) that drives dispatch

**Module format:** ESM throughout (`"type": "module"` in package.json). Internal imports use `.js` extensions (TypeScript requires this for ESM emit). Target is ES2022.

## Testing

Tests use vitest and mock both external packages (`@heroku/api-client` and `@heroku/types/3.sdk/routes`) via `vi.mock()`. Tests construct mock `Response` objects inline rather than using a shared fixture. Each source file has a co-located `.test.ts` file; there is no shared test helper or fixture directory.
