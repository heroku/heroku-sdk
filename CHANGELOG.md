# Changelog

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
