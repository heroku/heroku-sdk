# Changelog

## 0.3.0

### Breaking changes

- Removed the `./compositions/*` subpath export and the `src/compositions/`
  directory entirely. Every export had been marked `@deprecated` since
  `0.2.0`; that guidance is now mandatory.

### Migration

- `compositions/add-on` (`upgrade`) → `resources/platform/add-on` (`upgrade`)
  or `sdk.platform.addOn.upgrade` with `addOnExtensions`.
- `compositions/app` (`enableMaintenanceMode`, `disableMaintenanceMode`) →
  `resources/platform/app` (`enableMaintenance`, `disableMaintenance`) or
  `sdk.platform.app.{enableMaintenance,disableMaintenance}` with
  `appExtensions`.
- `compositions/dyno` (`scaleDynos`, `restartDynos`) →
  `resources/platform/dyno` (`scaleDynos`, `restartDynos`) or
  `sdk.platform.dyno.{scale,restart}` with `dynoExtensions`.
- `compositions/pipeline` (`promotePipeline`) →
  `resources/platform/pipeline-promotion` (`promotePipeline`) or
  `sdk.platform.pipelinePromotion.promote` with
  `pipelinePromotionExtensions`.
- `compositions/pg`:
  - `describePgDatabase` → `resources/data/database` (`describe`) or
    `sdk.data.database.describe` with `databaseExtensions`.
  - `listPgCredentials` → `resources/data/postgres-database`
    (`listCredentials`) or `sdk.data.postgresDatabase.listCredentials` with
    `postgresDatabaseExtensions`.
  - `describePgMaintenance` → `resources/data/maintenance` (`info`) or
    `sdk.data.maintenance.info` with `maintenanceExtensions`.
  - `runPgUpgrade`, `preparePgUpgrade` → `resources/data/database`
    (`runUpgrade`, `prepareUpgrade`) or
    `sdk.data.database.{runUpgrade,prepareUpgrade}` with
    `databaseExtensions`.
  - `listPgTransfers` → upstream `sdk.data.transfer.listByApp` route
    (no extension required).

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
