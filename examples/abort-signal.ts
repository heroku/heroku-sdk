/**
 * Demonstrates withOptions({signal}) cancelling an in-flight request.
 *
 * Run:
 *   tsx examples/abort-signal.ts
 *
 * Reads token from HEROKU_API_KEY or ~/.netrc. Run `heroku login` first
 * if you see "Unauthorized".
 */
import {createPlatformClient} from '../src/services/platform.js'

const heroku = createPlatformClient()

// --- Scenario 1: a manual abort cancels the in-flight request --------
//
// Kicks off `app.list()` and aborts ~1 ms later. Aborting before the
// response lands rejects the dispatched promise with an AbortError.
//
// We point at an unroutable address (RFC 5737 documentation range) so
// the connect attempt hangs long enough for the abort to land
// deterministically; otherwise the response could come back before we
// fire abort and the example would be racy.

console.log('Scenario 1: manual abort')
{
  const controller = new AbortController()
  const slow = createPlatformClient({baseUrl: 'http://192.0.2.1', service: 'custom'})
  const pending = slow.withOptions({signal: controller.signal}).app.list()
  setTimeout(() => controller.abort(), 1)

  try {
    await pending
    console.log('  unexpected: request resolved before abort')
  } catch (error) {
    console.log(`  request aborted as expected (${(error as Error).name}: ${(error as Error).message})`)
  }
}

// --- Scenario 2: AbortSignal.timeout(ms) bounds a real request -------
//
// Hits the live api.heroku.com endpoint and bounds the call at 5
// seconds. On a healthy connection this resolves immediately; on a
// slow / unreachable network the promise rejects with a TimeoutError.
// Useful pattern for callers that don't want to thread a controller
// through but still need a hard upper bound.

console.log('\nScenario 2: signal: AbortSignal.timeout(5000)')
try {
  const apps = await heroku.withOptions({signal: AbortSignal.timeout(5000)}).app.list()
  console.log(`  app.list() returned ${apps.length} apps within 5s`)
} catch (error) {
  console.log(`  request did not finish in 5s (${(error as Error).name}: ${(error as Error).message})`)
}
