import type {
  App, AppCreateOpts, ConfigVarUpdateOpts, TeamAppCreateOpts,
} from '@heroku/types/3.sdk'

import type {ResourceCtx} from '../../../core/extend-resource.js'
import type {Poller} from '../../../utils/poller.js'

export type CreateAndSetupOptions = {
  // `poller` matches heroku/cli PR #3857's SDK-standard convention.
  poller?: Poller<void>
  signal?: AbortSignal
}

export type CreateAndSetupInput = Record<string, unknown> & {
  addons?: Array<{as?: string; plan: string}>
  buildpack?: string
  configVars?: ConfigVarUpdateOpts
  name?: string
  region?: string
  space?: string
  stack?: string
  team?: string
}

/**
 * Create an app and run its post-create setup in one call.
 *
 * Creates the app (team/space → `teamApp.create`, otherwise `app.create`),
 * then fans out the optional setup steps in parallel: add-ons
 * (`addOn.create` per plan), config vars (`configVar.update`), and buildpack
 * (`buildpackInstallation.update`). Returns the created `App`.
 *
 * Progress is reported via the PR #3857 `poller` convention. Because the
 * steps run in parallel and the CLI's `ux.action` is a single global spinner,
 * the CLI is expected to render ONE combined "Setting up app…" spinner (D2
 * option A): we fire a single `onStart`/`onStop` pair around the whole setup
 * batch rather than per-step, so parallel steps don't clobber the spinner.
 *
 * Following the shared poller contract (see `utils/poller.ts`), `onStart`
 * fires immediately before the setup batch is dispatched and `onStop` fires
 * only once the batch settles successfully. If any step rejects, the
 * rejection propagates and `onStop` is never called — there is no
 * `finally`, so a failed batch does not report a clean stop.
 *
 * When a `signal` is supplied it is threaded into every HTTP request via the
 * scoped `withOptions({signal})` client, so an abort cancels in-flight calls
 * (not just the pre-flight `throwIfAborted` check).
 *
 * The CLI parses flags / heroku.yml into `input` and owns git-remote setup
 * and rendering; this method owns the API orchestration only.
 */
export async function createAndSetup(
  ctx: Pick<ResourceCtx, 'platform'>,
  input: CreateAndSetupInput,
  options: CreateAndSetupOptions = {},
): Promise<App> {
  options.signal?.throwIfAborted()

  const platform = options.signal ? ctx.platform.withOptions({signal: options.signal}) : ctx.platform

  const {addons, buildpack, configVars, ...createParams} = input

  const app: App = (createParams.space || createParams.team)
    ? (await platform.teamApp.create(createParams as unknown as TeamAppCreateOpts)) as App
    : await platform.app.create(createParams as unknown as AppCreateOpts)

  const appName = app.name!
  // Deferred thunks — nothing is dispatched until the batch is kicked off
  // below, so `onStart` reliably fires before any request goes out.
  const steps: Array<() => Promise<unknown>> = []

  if (addons?.length) {
    for (const addon of addons) {
      steps.push(() => platform.addOn.create(appName, {
        attachment: addon.as ? {name: addon.as} : undefined,
        plan: addon.plan,
      }))
    }
  }

  if (configVars && Object.keys(configVars).length > 0) {
    steps.push(() => platform.configVar.update(appName, configVars))
  }

  if (buildpack) {
    steps.push(() => platform.buildpackInstallation.update(appName, {updates: [{buildpack}]}))
  }

  if (steps.length > 0) {
    // Single combined progress window (D2 option A) — one spinner for the whole
    // parallel setup batch, not one per step. Per the poller contract, onStart
    // fires before dispatch and onStop only on success (no finally).
    options.poller?.onStart?.()
    await Promise.all(steps.map(step => step()))
    options.poller?.onStop?.()
  }

  return app
}
