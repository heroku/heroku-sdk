import type {Formation} from '@heroku/types/3.sdk'

import type {ResourceCtx} from '../../core/extend-resource.js'

import {extendResource} from '../../core/extend-resource.js'

export type DynoOptions = {
  signal?: AbortSignal
}

export type ScaleDynosUpdate = {
  dyno_size?: {id?: string; name?: string}
  quantity?: number | string
  size?: string
  type: string
}

export type RestartDynosTarget
  = | {dyno: string}
  | {type: string}

export function scaleDynos(
  ctx: Pick<ResourceCtx, 'platform'>,
  appIdentity: string,
  updates: ScaleDynosUpdate,
  options?: DynoOptions,
): Promise<Formation>
export function scaleDynos(
  ctx: Pick<ResourceCtx, 'platform'>,
  appIdentity: string,
  updates: ScaleDynosUpdate[],
  options?: DynoOptions,
): Promise<Formation[]>
export async function scaleDynos(
  ctx: Pick<ResourceCtx, 'platform'>,
  appIdentity: string,
  updates: ScaleDynosUpdate[] | ScaleDynosUpdate,
  options: DynoOptions = {},
): Promise<Formation | Formation[]> {
  options.signal?.throwIfAborted()

  if (Array.isArray(updates)) {
    // @ts-expect-error — SDK accepts string quantity and flat size; heroku-types FormationBatchUpdateOpts is stricter
    return ctx.platform.formation.batchUpdate(appIdentity, {updates})
  }

  const {type, ...body} = updates
  // @ts-expect-error — SDK accepts string quantity and flat size; heroku-types FormationUpdateOpts is stricter
  return ctx.platform.formation.update(appIdentity, type, body)
}

export async function restartDynos(
  ctx: Pick<ResourceCtx, 'platform'>,
  appIdentity: string,
  target?: RestartDynosTarget,
  options: DynoOptions = {},
): Promise<void> {
  options.signal?.throwIfAborted()

  if (!target) {
    await ctx.platform.dyno.restartAll(appIdentity)
    return
  }

  if ('dyno' in target) {
    await ctx.platform.dyno.restart(appIdentity, target.dyno)
    return
  }

  await ctx.platform.dyno.restartFormation(appIdentity, target.type)
}

export const dynoExtensions = extendResource('platform', 'dyno', ctx => ({
  restart: (appIdentity: string, target?: RestartDynosTarget, options?: DynoOptions) => (
    restartDynos(ctx, appIdentity, target, options)
  ),

  scale: ((appIdentity: string, updates: never, options?: DynoOptions) =>
    scaleDynos(ctx, appIdentity, updates, options)) as {
    (appIdentity: string, updates: ScaleDynosUpdate, options?: DynoOptions): Promise<Formation>
    (appIdentity: string, updates: ScaleDynosUpdate[], options?: DynoOptions): Promise<Formation[]>
  },
}))
