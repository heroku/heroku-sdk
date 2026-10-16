// Run: npm run example -- examples/sdk-tree-shaken.ts
// Requires: HEROKU_API_KEY in env (or resolve a stored token via @heroku/heroku-credential-manager).
// Demonstrates the most aggressive bundle path: no SDK class, no extension
// registry — just named-function imports.

import {describe as describeDatabase} from '../src/resources/data/database.js'
import {createDataClient} from '../src/services/data.js'
import {createPlatformClient} from '../src/services/platform.js'

const platform = createPlatformClient()
const data = createDataClient()

const app = process.argv[2] ?? 'my-app'

const result = await describeDatabase({data, platform}, app)
console.log(result)
