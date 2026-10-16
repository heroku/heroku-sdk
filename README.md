# Heroku SDK

A TypeScript SDK for the [Heroku Platform API](https://devcenter.heroku.com/articles/platform-api-reference), [Heroku Data API](https://devcenter.heroku.com/articles/heroku-postgres-api-reference), the Heroku Dashboard Backend, the Heroku Metrics API, and the Heroku Repositories API. It generates fully-typed clients at runtime from route definitions — no hand-written method per endpoint.

## Installation

```sh
npm install @heroku/sdk
```

## Usage

The simplest entry point is the `HerokuSDK` class. It exposes both the Platform and Data clients on a single object, plus an extension mechanism for hand-written helpers.

```ts
import { HerokuSDK } from '@heroku/sdk'
import { appExtensions } from '@heroku/sdk/extensions/platform'

// Zero-arg reads the token from HEROKU_API_KEY (see Authentication below)
const sdk = new HerokuSDK({ extensions: [appExtensions] })

// Upstream route (auto-generated from the API spec)
const apps = await sdk.platform.app.list()
const app  = await sdk.platform.app.info('my-app')
const favorites = await sdk.dashboardBackend.favorite.list({ type: 'app' })

// Hand-written extension method (provided by appExtensions)
await sdk.platform.app.enableMaintenance('my-app')
```

Extensions can also coordinate multiple services. For example, resolve a
pipeline first, then resolve its GitHub repository through Repositories API
with the Kolkrabbi-backed repositories service as a fallback:

```ts
import { HerokuSDK } from '@heroku/sdk'
import { reviewAppConfigExtensions } from '@heroku/sdk/extensions/platform'

const sdk = new HerokuSDK({ extensions: [reviewAppConfigExtensions] })
const pipeline = await sdk.platform.pipeline.info('my-pipeline')

if (!pipeline.id) throw new Error('Pipeline response did not include an id')
const repo = await sdk.platform.reviewAppConfig.resolveRepoName(pipeline.id)
```

You can also pass options directly:

```ts
const sdk = new HerokuSDK({ clientOptions: { token: 'your-api-token' } })
```

### Authentication

The SDK core is transport-agnostic: it reads no local files or keychains itself,
so it also runs in the browser. Token resolution is handled by
`@heroku/heroku-fetch`, which has a single default and otherwise defers to
whatever you pass in:

1. **`HEROKU_API_KEY` (the default)** — with no explicit token, heroku-fetch's
   default provider reads `HEROKU_API_KEY` from the environment, so a zero-arg
   `new HerokuSDK()` is authenticated whenever that variable is set.
2. **An explicit `token` (opt in to anything else)** — pass `clientOptions.token`
   (or a per-service `clientOptionsByService`) and the SDK uses it instead of the
   `HEROKU_API_KEY` default. This is how you authenticate from any other
   credential source — for example a token stored by `heroku login`, which the
   Heroku CLI resolves and injects itself (see the note below).

> **Note:** To authenticate as a logged-in Heroku CLI user, resolve the stored
> token in your (Node) application with
> [`@heroku/heroku-credential-manager`](https://github.com/heroku/heroku-credential-manager)
> and pass it in:
>
> ```ts
> import { getAuth } from '@heroku/heroku-credential-manager'
> import { HerokuSDK } from '@heroku/sdk'
>
> // account: your Heroku login email; host: the API host (usually api.heroku.com)
> const { token } = await getAuth(account, 'api.heroku.com')
> const sdk = new HerokuSDK({ clientOptions: { token } })
> ```
>
> This keeps keychain/filesystem access in the Node consumer (CLI, MCP server,
> VS Code extension) rather than in the SDK core, so the SDK stays usable in the
> browser.

Common client options apply to every service. In particular, a common `baseUrl`
overrides every service's default host, including Metrics and Repositories. Use
shallow per-service overrides when only specific services should use a host or
other client setting:

```ts
const sdk = new HerokuSDK({
  clientOptions: { token: 'your-api-token' },
  clientOptionsByService: {
    platform: { baseUrl: 'https://api.heroku.com' },
    repositoriesApi: { baseUrl: 'https://api.heroku.com' },
  },
})
```

### Per-service clients

If you only need one service (and want the smallest possible bundle), import the factory directly. These return the same typed client the SDK class wraps internally.

```ts
import { createPlatformClient }     from '@heroku/sdk/platform'
import { createDataClient }         from '@heroku/sdk/data'
import { createDashboardBackendClient } from '@heroku/sdk/dashboard-backend'
import { createMetricsClient }      from '@heroku/sdk/metrics'
import { createRepositoriesClient } from '@heroku/sdk/repositories'
import { createRepositoriesApiClient } from '@heroku/sdk/repositories-api'

const platform     = createPlatformClient()
const data         = createDataClient()
const dashboardBackend = createDashboardBackendClient()
const metrics      = createMetricsClient()
const repositories = createRepositoriesClient()
const repositoriesApi = createRepositoriesApiClient()

const apps = await platform.app.list()
const favorites = await dashboardBackend.favorite.list({ type: 'app' })
```

### Imports

| Symbol                                   | Import from                       |
| ---------------------------------------- | --------------------------------- |
| `HerokuSDK`, `extendResource`, types     | `@heroku/sdk`                     |
| `createPlatformClient`, `PlatformClient` | `@heroku/sdk/platform`            |
| `createDataClient`, `DataClient`         | `@heroku/sdk/data`                |
| `createDashboardBackendClient`, `DashboardBackendClient` | `@heroku/sdk/dashboard-backend` |
| `createMetricsClient`, `MetricsClient`   | `@heroku/sdk/metrics`             |
| `createRepositoriesClient`, `RepositoriesClient` | `@heroku/sdk/repositories` |
| `createRepositoriesApiClient`, `RepositoriesApiClient` | `@heroku/sdk/repositories-api` |
| `appExtensions`, `dynoExtensions`, …     | `@heroku/sdk/extensions/platform` |
| `databaseExtensions`, …                  | `@heroku/sdk/extensions/data`     |

## Development

### Prerequisites

- Node.js 22 (see `.tool-versions`)

### Install dependencies

```sh
npm install
```

### Build

```sh
npm run build
```

### Run tests

```sh
npm test
```

Run a single test file:

```sh
npm test -- src/core/dispatcher.test.ts
```

### Run examples

```sh
npm run example -- examples/basic-usage.ts
```
