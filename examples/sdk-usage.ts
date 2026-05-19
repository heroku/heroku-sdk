// Run: npm run example -- examples/sdk-usage.ts
// Requires: HEROKU_API_KEY in env or a valid .netrc entry for api.heroku.com.

import {HerokuSDK} from '../src/core/heroku-sdk.js'
import {databaseExtensions} from '../src/resources/extensions/data.js'
import {appExtensions, dynoExtensions} from '../src/resources/extensions/platform.js'

const sdk = new HerokuSDK({
  extensions: [appExtensions, dynoExtensions, databaseExtensions],
})

const app = process.argv[2] ?? 'my-app'

// Extension method (hand-written)
await sdk.platform.app.enableMaintenance(app)

// Upstream route method (still typed and callable on the same namespace)
const info = await sdk.platform.app.info(app)
console.log(`maintenance=${info.maintenance}`)

await sdk.platform.app.disableMaintenance(app)
