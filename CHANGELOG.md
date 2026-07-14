# Changelog

## [0.5.0](https://github.com/heroku/heroku-sdk/compare/sdk-v0.4.3...sdk-v0.5.0) (2026-07-14)


### ⚠ BREAKING CHANGES

* cleans-up exports ([#26](https://github.com/heroku/heroku-sdk/issues/26))

### Features

* add dyno composition (list/scale/restart) ([1da9fdf](https://github.com/heroku/heroku-sdk/commit/1da9fdf1da81649d427626f21b20b30760ebfa95))
* add dyno composition (list/scale/restart) ([59039da](https://github.com/heroku/heroku-sdk/commit/59039da157a9b9f4ae84b26c2483ff72182c8853))
* add promotePipeline composition ([#5](https://github.com/heroku/heroku-sdk/issues/5)) ([8923ded](https://github.com/heroku/heroku-sdk/commit/8923dedf90cce960b7c820703b67c03c45bc4aa4))
* **add-on:** listPlansForAddon and priceForPlan helpers ([#40](https://github.com/heroku/heroku-sdk/issues/40)) ([ea41870](https://github.com/heroku/heroku-sdk/commit/ea41870c186fdc8dc0affc12e8b4a6a94d2240da))
* addon resource improvements + per-call header overrides ([#23](https://github.com/heroku/heroku-sdk/issues/23)) ([d21fbf7](https://github.com/heroku/heroku-sdk/commit/d21fbf746da71d9400a758faad3cbacb6894aba7))
* adds app info resource ([#47](https://github.com/heroku/heroku-sdk/issues/47)) ([f6b0ee4](https://github.com/heroku/heroku-sdk/commit/f6b0ee404c3b9bc5c0cf5a445c0de72431e1e611))
* auto-pagination to dispatcher GET array responses ([#44](https://github.com/heroku/heroku-sdk/issues/44)) ([bb5d75d](https://github.com/heroku/heroku-sdk/commit/bb5d75da1c41ecf52a903e1c8e41d26a15151fba))
* **client:** add withOptions to set sticky signal/headers/timeout ([#34](https://github.com/heroku/heroku-sdk/issues/34)) ([be2b097](https://github.com/heroku/heroku-sdk/commit/be2b09708f210f7780f28b80a56343453173e82a))
* **compositions:** add listPipelineApps ([#17](https://github.com/heroku/heroku-sdk/issues/17)) ([34fe268](https://github.com/heroku/heroku-sdk/commit/34fe268d74bfabad2dcbc62278ac70a624154420))
* **compositions:** add maintenance mode functions to app resource ([#10](https://github.com/heroku/heroku-sdk/issues/10)) ([9533e6d](https://github.com/heroku/heroku-sdk/commit/9533e6d7dce128f152621c76807559d09a2b2c98))
* **compositions:** add pg resource for legacy Postgres add-ons ([#9](https://github.com/heroku/heroku-sdk/issues/9)) ([6a333b9](https://github.com/heroku/heroku-sdk/commit/6a333b920ea80ebda1c4f8a6df166b822f84d868))
* **compositions:** expand add-on resolution and pg helpers ([157713e](https://github.com/heroku/heroku-sdk/commit/157713ea0ea6250f941297cfc75fc8ea3411a1e5))
* **compositions:** stream release-command output during promotePipeline ([#15](https://github.com/heroku/heroku-sdk/issues/15)) ([1c6c155](https://github.com/heroku/heroku-sdk/commit/1c6c15552856c6bdcb6f634884d2fba5c88a49c3))
* **core:** instrument dispatcher and client with debug ([#11](https://github.com/heroku/heroku-sdk/issues/11)) ([4af40e6](https://github.com/heroku/heroku-sdk/commit/4af40e64f30c593f671888ed7115ad000720acb1))
* **dyno:** add waitForInfo helper + fix exports for folder resources ([#49](https://github.com/heroku/heroku-sdk/issues/49)) ([2c5a545](https://github.com/heroku/heroku-sdk/commit/2c5a545abe8b433fd086fe65e9bf1bb18303f70f))
* **log-session:** add parseHerokuLogLine for runtime event parsing ([#43](https://github.com/heroku/heroku-sdk/issues/43)) ([95fddd4](https://github.com/heroku/heroku-sdk/commit/95fddd4412d6288fb59f607f417abae3aeb8b972))
* **log-session:** recreate streamLogs on transport errors ([#46](https://github.com/heroku/heroku-sdk/issues/46)) ([6399a52](https://github.com/heroku/heroku-sdk/commit/6399a5262e2122eec06ec33df049ed4181159552))
* migrate pg adapters ([#38](https://github.com/heroku/heroku-sdk/issues/38)) ([5272cd2](https://github.com/heroku/heroku-sdk/commit/5272cd22ced4ece97c39a02ccc2d236e269f6b96))
* new add-on composition helpers ([#16](https://github.com/heroku/heroku-sdk/issues/16)) ([86cfd49](https://github.com/heroku/heroku-sdk/commit/86cfd496eb33066d2ee05834460c1ee0ea2604fa))
* package subpath exports ([#54](https://github.com/heroku/heroku-sdk/issues/54)) ([655fa84](https://github.com/heroku/heroku-sdk/commit/655fa8484620b1c4831df6611e1037848fc07bdf))
* ps process tier support ([#37](https://github.com/heroku/heroku-sdk/issues/37)) ([c582a10](https://github.com/heroku/heroku-sdk/commit/c582a10197a9dc93cdd56ecb7a5bc3176ccf4e22))
* ps scale shield support ([#35](https://github.com/heroku/heroku-sdk/issues/35)) ([4d52a7d](https://github.com/heroku/heroku-sdk/commit/4d52a7d6a74ae10262092453e5254d9d9d00a499))
* resource extensions (HerokuSDK + extendResource) ([#18](https://github.com/heroku/heroku-sdk/issues/18)) ([339f043](https://github.com/heroku/heroku-sdk/commit/339f043a0e3b084d07051c43631272fc715b4a1a))
* **resources:** add createAndWait orchestration to add-on resource ([#27](https://github.com/heroku/heroku-sdk/issues/27)) ([efce1d4](https://github.com/heroku/heroku-sdk/commit/efce1d4fffd1be97127f4fe78bc65b1e22d6d0de))
* **resources:** add streamLogs to logSession resource ([#28](https://github.com/heroku/heroku-sdk/issues/28)) ([19e7998](https://github.com/heroku/heroku-sdk/commit/19e799844a066c17b32a137840ce4630f18215d2))
* **resources:** withSearchParams, pipeline resolution, debug coverage ([#25](https://github.com/heroku/heroku-sdk/issues/25)) ([89cfddd](https://github.com/heroku/heroku-sdk/commit/89cfdddbd92ac7e0c4e6720ae477af7fc7876d0c))
* **services:** add createDataClient factory ([f78d9d4](https://github.com/heroku/heroku-sdk/commit/f78d9d4c4c165aa127dfd3629ee78e07b5b3b1ee))
* **services:** add createPlatformClient factory ([a0ccf42](https://github.com/heroku/heroku-sdk/commit/a0ccf42c0588d0a18f7a90cf3fe571e2f605c5f8))
* update package exports ([#50](https://github.com/heroku/heroku-sdk/issues/50)) ([28a93bf](https://github.com/heroku/heroku-sdk/commit/28a93bfe128d25b6e61cef8af4d7685698e03204))


### Bug Fixes

* build failure due to upstream type changes ([#33](https://github.com/heroku/heroku-sdk/issues/33)) ([4a13a9f](https://github.com/heroku/heroku-sdk/commit/4a13a9fe2ee7e2a1a6d94b548926366bd95bd6a3))
* **core:** preserve extensions after withOptions/withHeaders ([#41](https://github.com/heroku/heroku-sdk/issues/41)) ([012bcc8](https://github.com/heroku/heroku-sdk/commit/012bcc89c5a2ab7c7b2ad67918dae7378bbecc10))
* postgres list behavior ([#55](https://github.com/heroku/heroku-sdk/issues/55)) ([7cfe8a8](https://github.com/heroku/heroku-sdk/commit/7cfe8a8aa29f362737c2fd2e67a11e77b2b40bac))


### Dependencies

* bump actions/create-github-app-token from 2 to 3 ([ecdaa79](https://github.com/heroku/heroku-sdk/commit/ecdaa798b0910cafbf78963217de855f9e52594e))
* bump the dev-patch-minor-dependencies group across 1 directory with 2 updates ([8bee963](https://github.com/heroku/heroku-sdk/commit/8bee9630ae088f4818dacb5e73cbba1bad63659e))
* bump the dev-patch-minor-dependencies group across 1 directory with 4 updates ([#45](https://github.com/heroku/heroku-sdk/issues/45)) ([5135fc8](https://github.com/heroku/heroku-sdk/commit/5135fc8ed4e88d4b8c01c6bf02285f319f07dad7))
* bump undici from 6.25.0 to 6.27.0 ([#62](https://github.com/heroku/heroku-sdk/issues/62)) ([de0d140](https://github.com/heroku/heroku-sdk/commit/de0d140c497b7c4ab76a71a77c6e3d0ab50a5e11))
* bump ws from 8.20.1 to 8.21.0 ([#64](https://github.com/heroku/heroku-sdk/issues/64)) ([b7fa978](https://github.com/heroku/heroku-sdk/commit/b7fa978f519cfbb655b190d8287801f9f3fd6ca8))


### Code Refactoring

* **compositions:** migrate promotePipeline to createPlatformClient ([408d681](https://github.com/heroku/heroku-sdk/commit/408d681bc1d5080bea1ca4de52f0b91494d091e3))
* **core:** add generic createClient engine ([9c38a88](https://github.com/heroku/heroku-sdk/commit/9c38a881251ee319597475610d2702f325df7fd2))
* **core:** drop createHerokuClient ([64ff1ef](https://github.com/heroku/heroku-sdk/commit/64ff1ef4b0bac322a06087ff43491187ef1ee87a))
* drop listDynos from dyno composition ([b445516](https://github.com/heroku/heroku-sdk/commit/b44551685d27a4e6d73454996db371d5d804b933))
* **index:** drop HerokuClient root export ([7eb1838](https://github.com/heroku/heroku-sdk/commit/7eb18383f302be32a2fc02111420713d61b92075))
* **platform:** folder-per-resource layout, split add-on.ts ([#36](https://github.com/heroku/heroku-sdk/issues/36)) ([cede5b7](https://github.com/heroku/heroku-sdk/commit/cede5b7936d296a2efb7741b2d2d4f056c9b356f))


### Miscellaneous Chores

* cleans-up exports ([#26](https://github.com/heroku/heroku-sdk/issues/26)) ([20dbe31](https://github.com/heroku/heroku-sdk/commit/20dbe314ea00d057b26b329f5b47736f26821503))

## 0.3.0

### Breaking changes

- Removed the `./compositions/*` subpath export and the `src/compositions/`
  directory entirely.

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
