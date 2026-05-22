// Run: npm run example -- examples/logs.ts <app> [--tail]
// Requires: HEROKU_API_KEY in env or a valid .netrc entry for api.heroku.com.
//
// Mirrors a simplified `heroku logs` against the SDK's streamLogs.
// Without --tail, prints the most recent 100 lines and exits.
// With --tail, keeps the stream open until you Ctrl-C; the SDK
// transparently recreates the session if the platform times out.

import {HerokuSDK} from '../src/index.js'
import {logSessionExtensions} from '../src/resources/extensions/platform.js'

const args = process.argv.slice(2)
const tailFlag = args.indexOf('--tail')
const tail = tailFlag !== -1
if (tail) args.splice(tailFlag, 1)

const app = args[0]
if (!app) {
  throw new Error('Usage: npm run example -- examples/logs.ts <app> [--tail]')
}

const controller = new AbortController()
process.once('SIGINT', () => {
  process.stderr.write('\nstopping...\n')
  controller.abort()
})

const sdk = new HerokuSDK({extensions: [logSessionExtensions]})

try {
  for await (const line of sdk.platform.logSession.streamLogs(app, {
    lines: 100,
    signal: controller.signal,
    tail,
  })) {
    process.stdout.write(line + '\n')
  }
} catch (error) {
  // Ctrl-C is the expected exit path for --tail; swallow the abort.
  if (!controller.signal.aborted) throw error
}
