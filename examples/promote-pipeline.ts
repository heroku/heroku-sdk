// Run: npm run example -- examples/promote-pipeline.ts
// Requires: HEROKU_API_KEY in env or a valid .netrc entry for api.heroku.com.
//          PIPELINE_ID, SOURCE_APP_ID, TARGET_APP_ID in env.

import {HerokuSDK} from '../src/index.js'
import {pipelinePromotionExtensions} from '../src/resources/extensions/platform.js'

const sdk = new HerokuSDK({extensions: [pipelinePromotionExtensions]})

const result = await sdk.platform.pipelinePromotion.promote(
  {
    pipeline: {id: process.env.PIPELINE_ID!},
    source: {app: {id: process.env.SOURCE_APP_ID!}},
    targets: [{app: {id: process.env.TARGET_APP_ID!}}],
  },
  {intervalMs: 2000, timeoutMs: 60_000},
)

console.log(`Promotion ${result.promotion.id} finished with status: ${result.promotion.status}`)
for (const target of result.targets) {
  console.log(`  → target ${target.app?.id}: ${target.status}`)
}
