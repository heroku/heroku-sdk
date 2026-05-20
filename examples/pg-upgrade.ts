// Run: npm run example -- examples/pg-upgrade.ts
// DESTRUCTIVE: runs an actual Postgres version upgrade.
// Requires: HEROKU_API_KEY in env or a valid .netrc entry for api.heroku.com.
//          APP=<app-name>, CONFIRM=<app-name> (must match), MODE=prepare|run.
//          ADDON, PG_VERSION optional.

import {HerokuSDK} from '../src/core/heroku-sdk.js'
import {databaseExtensions} from '../src/resources/extensions/data.js'

const sdk = new HerokuSDK({extensions: [databaseExtensions]})

const app = process.env.APP!
const addon = process.env.ADDON
const version = process.env.PG_VERSION
const mode = process.env.MODE ?? 'run'

if (process.env.CONFIRM !== app) {
  throw new Error(`Set CONFIRM=${app} to proceed (this performs an actual upgrade).`)
}

const body = version ? {version} : {}

if (mode === 'prepare') {
  const result = await sdk.data.database.prepareUpgrade(app, addon, body)
  console.log('prepareUpgrade:', result)
} else {
  const result = await sdk.data.database.runUpgrade(app, addon, body)
  console.log('runUpgrade:', result)
}
