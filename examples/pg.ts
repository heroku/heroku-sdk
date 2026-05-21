// Run: npm run example -- examples/pg.ts
// Requires: HEROKU_API_KEY in env or a valid .netrc entry for api.heroku.com.
//          APP=<app-name> in env. ADDON optional (defaults to DATABASE_URL).

import {HerokuSDK} from '../src/index.js'
import {
  databaseExtensions,
  maintenanceExtensions,
  postgresDatabaseExtensions,
} from '../src/resources/extensions/data.js'

const sdk = new HerokuSDK({
  extensions: [databaseExtensions, postgresDatabaseExtensions, maintenanceExtensions],
})

const app = process.env.APP!
const addon = process.env.ADDON

const dbInfo = await sdk.data.database.describe(app, addon)
console.log(`Database (${app}::${addon ?? 'DATABASE_URL'}):`, dbInfo)

const creds = await sdk.data.postgresDatabase.listCredentials(app, addon)
console.log('Credentials:', creds)

const maint = await sdk.data.maintenance.info(app, addon)
console.log('Maintenance:', maint)

// transfer.listByApp is an upstream route on the data client (not an extension);
// it's available on the SDK without registering an extension bundle.
const transfers = await sdk.data.transfer.listByApp(app)
console.log('Transfers:', transfers)
