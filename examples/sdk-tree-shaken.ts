// Run: npm run example -- examples/sdk-tree-shaken.ts
// Demonstrates the most aggressive bundle path: no SDK class, no extension
// registry — just named-function imports.

import {createDataClient} from '../src/services/data.js'
import {createPlatformClient} from '../src/services/platform.js'
import {describe_ as describeDatabase} from '../src/resources/data/database.js'

const platform = createPlatformClient()
const data = createDataClient()

const app = process.argv[2] ?? 'my-app'

const result = await describeDatabase({data, platform}, app)
console.log(result)
