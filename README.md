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

// Reads token from HEROKU_API_KEY or ~/.netrc
const sdk = new HerokuSDK({ extensions: [appExtensions] })

// Upstream route (auto-generated from the API spec)
const apps = await sdk.platform.app.list()
const app  = await sdk.platform.app.info('my-app')
const favorites = await sdk.dashboardBackend.favorite.list({ type: 'app' })

// Hand-written extension method (provided by appExtensions)
await sdk.platform.app.enableMaintenance('my-app')
```

You can also pass options directly:

```ts
const sdk = new HerokuSDK({ clientOptions: { token: 'your-api-token' } })
```

### Per-service clients

If you only need one service (and want the smallest possible bundle), import the factory directly. These return the same typed client the SDK class wraps internally.

```ts
import { createPlatformClient }     from '@heroku/sdk/platform'
import { createDataClient }         from '@heroku/sdk/data'
import { createDashboardBackendClient } from '@heroku/sdk/dashboard-backend'
import { createMetricsClient }      from '@heroku/sdk/metrics'
import { createRepositoriesClient } from '@heroku/sdk/repositories'

const platform     = createPlatformClient()
const data         = createDataClient()
const dashboardBackend = createDashboardBackendClient()
const metrics      = createMetricsClient()
const repositories = createRepositoriesClient()

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
