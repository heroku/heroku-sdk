import type {
  App, AppCreateOpts, ConfigVarUpdateOpts, TeamAppCreateOpts,
} from '@heroku/types/3.sdk'

import type {ResourceCtx} from '../../../core/extend-resource.js'

// `poller` matches heroku/cli PR #3857's SDK-standard convention.
export type SetupStep = {kind: 'addon' | 'buildpack' | 'config-vars'; label?: string}

export type CreateAndSetupOptions = {
  poller?: {
    onStart?: (step: SetupStep) => void
    onStop?: (step?: SetupStep) => void
  }
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
 * Per the shared poller contract, `onStart` fires BEFORE any request is
 * dispatched, and `onStop` fires ONLY on success — if a step rejects, the
 * error propagates and `onStop` is never called (the CLI's error path stops
 * the spinner). Signal threading uses the standard `withOptions({signal})`
 * scoped-client idiom so an abort cancels in-flight requests, not just the
 * pre-flight `throwIfAborted()`.
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
  // Deferred thunks: nothing is dispatched until the batch is launched below,
  // so `onStart` reliably fires before the first request.
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
    // parallel setup batch, not one per step. onStart before dispatch; onStop
    // only on success (no try/finally — a rejection skips onStop per contract).
    options.poller?.onStart?.({kind: 'config-vars', label: 'setup'})
    await Promise.all(steps.map(step => step()))
    options.poller?.onStop?.()
  }

  return app
}
