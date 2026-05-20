// Run: npm run example -- examples/dyno.ts
// Requires: HEROKU_API_KEY in env or a valid .netrc entry for api.heroku.com.
//          APP=<app-name> in env.

import {HerokuSDK} from '../src/core/heroku-sdk.js'
import {dynoExtensions} from '../src/resources/extensions/platform.js'

const sdk = new HerokuSDK({extensions: [dynoExtensions]})
const app = process.env.APP!

const formations = await sdk.platform.dyno.scale(app, [{quantity: 1, type: 'web'}])
for (const formation of formations) {
  console.log(`scaled ${formation.type} → ${formation.quantity}`)
}

await sdk.platform.dyno.restart(app, {type: 'web'})
console.log('restarted web dynos')
