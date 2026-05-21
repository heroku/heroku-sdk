// Run: npm run example -- examples/list-pipeline-apps.ts <pipeline-name-or-id>
// Requires: HEROKU_API_KEY in env or a valid .netrc entry for api.heroku.com.
//
// Sanity-check that listPipelineApps still resolves apps after dropping
// the spurious `version=3.filters` Accept variant. Accepts a pipeline
// name or UUID — the name path additionally exercises the new
// resolvePipeline / withSearchParams plumbing.

import {HerokuSDK} from '../src/core/heroku-sdk.js'
import {
  pipelineCouplingExtensions,
  pipelineExtensions,
} from '../src/resources/extensions/platform.js'

const identity = process.argv[2]
if (!identity) {
  throw new Error('Usage: npm run example -- examples/list-pipeline-apps.ts <pipeline-name-or-id>')
}

const sdk = new HerokuSDK({
  extensions: [pipelineExtensions, pipelineCouplingExtensions],
})

const pipeline = await sdk.platform.pipeline.resolve(identity)
console.log(`Resolved pipeline ${pipeline.name} (${pipeline.id})`)

const apps = await sdk.platform.pipelineCoupling.listApps(pipeline.id!)

console.log(`Found ${apps.length} apps coupled to pipeline:`)
for (const app of apps) {
  console.log(`  ${app.name} (${app.id}) — stage=${app.pipelineCoupling.stage}`)
}
