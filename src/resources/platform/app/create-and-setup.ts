import type {
  App, AppCreateOpts, ConfigVarUpdateOpts, TeamApp, TeamAppCreateOpts,
} from '@heroku/types/3.sdk'

import type {ResourceCtx} from '../../../core/extend-resource.js'
import type {Poller} from '../../../utils/poller.js'

import {waitForProvisioning} from '../add-on/wait-for-provisioning.js'

export type CreateAndSetupOptions = {
  // `poller` matches heroku/cli PR #3857's SDK-standard convention.
  poller?: Poller<void>
  signal?: AbortSignal
  /**
   * Polling interval passed through to `waitForProvisioning` while waiting
   * for add-ons to leave `provisioning`. Defaults to that helper's default
   * (5000ms). Tests set this to 0 to avoid real waits.
   */
  waitIntervalMs?: number
}

/**
 * Setup-only fields layered on top of the generated create-opts. These are
 * not part of the platform create request — `createAndSetup` peels them off
 * and drives the follow-up calls (add-ons, config vars, buildpack).
 */
type SetupFields = {
  addons?: Array<{as?: string; plan: string}>
  buildpack?: string
  configVars?: ConfigVarUpdateOpts
}

/**
 * Input to `createAndSetup`: the generated create-opts for either a personal
 * app (`AppCreateOpts`) or a team/space app (`TeamAppCreateOpts`), plus the
 * setup-only fields. Deriving from the generated shapes means misspelled or
 * mistyped create fields are rejected at compile time, while any valid
 * `AppCreateOpts`/`TeamAppCreateOpts` value remains assignable.
 */
export type CreateAndSetupInput
  = | (AppCreateOpts & SetupFields)
    | (SetupFields & TeamAppCreateOpts)

/**
 * Run a set of concurrent operations to completion, then surface any
 * failures as one aggregate error.
 *
 * Uses `Promise.allSettled` (not `Promise.all`) so every started operation
 * settles before this resolves/throws — no operation is left in-flight when
 * the caller receives an error. If any operation rejected, throws an
 * `AggregateError` carrying every rejection reason.
 */
async function settleAll(ops: Array<Promise<unknown>>, message: string): Promise<void> {
  const results = await Promise.allSettled(ops)
  const reasons = results
    .filter((r): r is PromiseRejectedResult => r.status === 'rejected')
    .map(r => r.reason)
  if (reasons.length > 0) {
    throw new AggregateError(reasons, message)
  }
}

/**
 * Create an app and run its post-create setup in one call.
 *
 * Creates the app (team/space → `teamApp.create`, otherwise `app.create`),
 * then runs setup as ordered, sequential phases:
 *
 *   - Phase 1 — add-ons: create every add-on (concurrently) and wait for each
 *     to finish provisioning via `waitForProvisioning`. The platform writes
 *     add-on config vars (e.g. `DATABASE_URL`) asynchronously *after*
 *     `addOn.create` returns — the create response is often still
 *     `state: 'provisioning'` — so we must not touch config vars until every
 *     add-on is fully provisioned.
 *   - Phase 2 — config vars + buildpack: apply explicit config vars
 *     (`configVar.update`) and the buildpack (`buildpackInstallation.update`).
 *     These two are independent of each other and run concurrently, but
 *     strictly after phase 1 completes.
 *
 * Within a phase, operations run concurrently via `Promise.allSettled`, so a
 * failure never leaves a sibling operation in-flight; a phase that had any
 * rejection throws an `AggregateError`. Because phases are sequential, a
 * phase-1 failure means phase-2 operations are never started.
 *
 * Returns the created `App | TeamApp`.
 *
 * Progress is reported via the PR #3857 `poller` convention: `onStart` fires
 * once immediately before any setup work begins and `onStop` fires once only
 * on overall success. There is no `finally`, so a failed setup does not report
 * a clean stop.
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
): Promise<App | TeamApp> {
  options.signal?.throwIfAborted()

  const platform = options.signal ? ctx.platform.withOptions({signal: options.signal}) : ctx.platform

  const {addons, buildpack, configVars, ...createParams} = input

  const app: App | TeamApp = ('team' in createParams || 'space' in createParams)
    ? await platform.teamApp.create(createParams)
    : await platform.app.create(createParams)

  if (!app.name) {
    throw new Error('createAndSetup: created app has no name')
  }

  const appName = app.name

  const hasAddons = Boolean(addons?.length)
  const hasConfigVars = Boolean(configVars && Object.keys(configVars).length > 0)
  const hasBuildpack = Boolean(buildpack)

  if (!hasAddons && !hasConfigVars && !hasBuildpack) {
    return app
  }

  // Single combined progress window (D2 option A) — one spinner for the whole
  // setup batch, not one per step. Per the poller contract, onStart fires
  // before any work begins and onStop only on success (no finally).
  options.poller?.onStart?.()

  // Phase 1: create every add-on and wait for it to finish provisioning.
  // Config vars (phase 2) depend on this because the platform writes add-on
  // config vars asynchronously after `addOn.create` returns.
  if (hasAddons) {
    await settleAll(
      addons!.map(async addon => {
        const created = await platform.addOn.create(appName, {
          attachment: addon.as ? {name: addon.as} : undefined,
          plan: addon.plan,
        })
        return waitForProvisioning({platform}, created, {
          appIdentity: appName,
          signal: options.signal,
          waitIntervalMs: options.waitIntervalMs,
        })
      }),
      'createAndSetup: one or more add-ons failed to provision',
    )
  }

  // Phase 2: config vars and buildpack are independent of each other and run
  // concurrently, but strictly after all add-ons are provisioned.
  const phase2: Array<Promise<unknown>> = []
  if (hasConfigVars) {
    phase2.push(platform.configVar.update(appName, configVars!))
  }

  if (hasBuildpack) {
    phase2.push(platform.buildpackInstallation.update(appName, {updates: [{buildpack: buildpack!}]}))
  }

  if (phase2.length > 0) {
    await settleAll(phase2, 'createAndSetup: config var / buildpack setup failed')
  }

  options.poller?.onStop?.()

  return app
}
