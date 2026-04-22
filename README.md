# Heroku SDK

A TypeScript SDK for the [Heroku Platform API](https://devcenter.heroku.com/articles/platform-api-reference). It provides a fully-typed client.

## Installation

```sh
npm install @heroku/sdk
```

## Usage

```ts
import { createHerokuClient } from '@heroku/sdk'

// Reads token from HEROKU_API_KEY or ~/.netrc
const heroku = createHerokuClient()

// List all apps
const apps = await heroku.app.list()

// Get a specific app
const app = await heroku.app.info('my-app')

// Create an app
const newApp = await heroku.app.create({ name: 'my-new-app' })

// Delete an app
await heroku.app.delete('my-app')
```

You can also pass options directly:

```ts
const heroku = createHerokuClient({ token: 'your-api-token' })
```

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
