import type {App, BuildpackInstallation} from '@heroku/types/3.sdk'

import {NotFoundError} from '@heroku/heroku-fetch'

import type {ResourceCtx} from '../../../core/extend-resource.js'
import type {PlatformClient} from '../../../services/platform.js'

export type DiffAppsOptions = {
  signal?: AbortSignal
}

export interface DiffRow {
  app1: string | undefined
  app2: string | undefined
  prop: string
}

async function checksum(platform: PlatformClient, app: string): Promise<null | string> {
  try {
    const releases = await platform.withHeaders({Range: 'version ..; max=1, order=desc'}).release.list(app)
    if (releases?.[0]?.slug) {
      const slugId = releases[0].slug!.id
      const slug = await platform.slug.info(app, slugId)
      return slug?.checksum ?? null
    }

    return null
  } catch (error: unknown) {
    if (isNotFound(error)) {
      throw new Error(`App not found: ${app}`, {cause: error})
    }

    throw error
  }
}

function isNotFound(error: unknown): boolean {
  return error instanceof NotFoundError
}

async function diffFiles(platform: PlatformClient, app1: string, app2: string): Promise<DiffRow[]> {
  const sums = await Promise.all([checksum(platform, app1), checksum(platform, app2)])
  return sums[0] === sums[1] ? [] : [{app1: sums[0] ?? undefined, app2: sums[1] ?? undefined, prop: 'slug (checksum)'}]
}

async function diffEnv(platform: PlatformClient, app1: string, app2: string): Promise<DiffRow[]> {
  const [vars1, vars2] = await Promise.all([
    platform.configVar.infoForApp(app1),
    platform.configVar.infoForApp(app2),
  ])
  const cfg1 = vars1 ?? {}
  const cfg2 = vars2 ?? {}
  const keys = new Set([...Object.keys(cfg1), ...Object.keys(cfg2)])
  return [...keys]
    .filter(k => cfg1[k] !== cfg2[k])
    .map(k => ({app1: cfg1[k], app2: cfg2[k], prop: `config (${k})`}))
}

async function diffStack(platform: PlatformClient, app1: string, app2: string): Promise<DiffRow[]> {
  const [res1, res2]: [App, App] = await Promise.all([
    platform.app.info(app1),
    platform.app.info(app2),
  ])
  const a = res1?.stack?.name
  const b = res2?.stack?.name
  return a === b ? [] : [{app1: a, app2: b, prop: 'stack'}]
}

async function diffBuildpacks(platform: PlatformClient, app1: string, app2: string): Promise<DiffRow[]> {
  const [res1, res2] = await Promise.all([
    platform.buildpackInstallation.list(app1),
    platform.buildpackInstallation.list(app2),
  ])
  const bps1: BuildpackInstallation[] = res1 ?? []
  const bps2: BuildpackInstallation[] = res2 ?? []
  const urls1 = bps1.map(obj => obj.buildpack?.url ?? '')
  const urls2 = bps2.map(obj => obj.buildpack?.url ?? '')
  const longest = urls1.length >= urls2.length ? urls1 : urls2
  const pairs = longest.map((_, k) => ({
    app1: urls1[k],
    app2: urls2[k],
    prop: `buildpack (${k})`,
  }))

  return pairs.filter(pair => pair.app1 !== pair.app2)
}

async function diffAddons(platform: PlatformClient, app1: string, app2: string): Promise<DiffRow[]> {
  const [addons1, addons2] = await Promise.all([
    platform.addOn.listByApp(app1),
    platform.addOn.listByApp(app2),
  ])
  const names1 = new Set((addons1 ?? []).map(addon => addon.addon_service?.name ?? '').filter(Boolean))
  const names2 = new Set((addons2 ?? []).map(addon => addon.addon_service?.name ?? '').filter(Boolean))
  const only1 = [...names1].filter(name => !names2.has(name)).map(name => ({app1: 'true', app2: 'false', prop: `add-on (${name})`}))
  const only2 = [...names2].filter(name => !names1.has(name)).map(name => ({app1: 'false', app2: 'true', prop: `add-on (${name})`}))

  return [...only1, ...only2]
}

async function diffFeatures(platform: PlatformClient, app1: string, app2: string): Promise<DiffRow[]> {
  const [features1, features2] = await Promise.all([
    platform.appFeature.list(app1),
    platform.appFeature.list(app2),
  ])
  const names1 = new Set((features1 ?? []).map(f => (f.enabled ? f.name : null)).filter(Boolean) as string[])
  const names2 = new Set((features2 ?? []).map(f => (f.enabled ? f.name : null)).filter(Boolean) as string[])
  const only1 = [...names1].filter(name => !names2.has(name)).map(name => ({app1: 'enabled', app2: 'disabled', prop: `feature (${name})`}))
  const only2 = [...names2].filter(name => !names1.has(name)).map(name => ({app1: 'disabled', app2: 'enabled', prop: `feature (${name})`}))

  return [...only1, ...only2]
}

/**
 * Composite diff of two apps: compares slug checksum, config vars, stack,
 * buildpacks, add-ons, and features, returning one `DiffRow` per differing
 * property.
 *
 * Faithful port of the Heroku CLI's `apps:diff`: `diffFiles` runs first (so a
 * missing app surfaces the `App not found: <app>` error before the rest), then
 * the remaining five diffs run in parallel and their rows are concatenated in
 * the CLI's order. Rendering (truncation, table output) stays with the caller.
 */
export async function diffApps(
  ctx: Pick<ResourceCtx, 'platform'>,
  app1: string,
  app2: string,
  options: DiffAppsOptions = {},
): Promise<DiffRow[]> {
  options.signal?.throwIfAborted()
  const platform = options.signal
    ? ctx.platform.withOptions({signal: options.signal})
    : ctx.platform

  const files = await diffFiles(platform, app1, app2)

  const [env, stack, bp, addons, features] = await Promise.all([
    diffEnv(platform, app1, app2),
    diffStack(platform, app1, app2),
    diffBuildpacks(platform, app1, app2),
    diffAddons(platform, app1, app2),
    diffFeatures(platform, app1, app2),
  ])

  return [...files, ...env, ...stack, ...bp, ...addons, ...features]
}
