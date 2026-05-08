import {promotePipeline} from '../src/compositions/promote-pipeline.js'

const result = await promotePipeline(
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
