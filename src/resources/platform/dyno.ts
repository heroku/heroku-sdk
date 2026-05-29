import type {Formation} from '@heroku/types/3.sdk'

import {HerokuApiClient} from '@heroku/heroku-fetch'

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
  _ctx: Pick<ResourceCtx, 'platform'>,
  appIdentity: string,
  updates: ScaleDynosUpdate[] | ScaleDynosUpdate,
  options: DynoOptions = {},
): Promise<Formation | Formation[]> {
  options.signal?.throwIfAborted()

  const client = new HerokuApiClient({service: 'platform'})

  if (Array.isArray(updates)) {
    const response = await client.patch(`/apps/${appIdentity}/formation`, {
      body: {updates},
    })
    return response.json() as Promise<Formation[]>
  }

  const {type, ...body} = updates
  const response = await client.patch(`/apps/${appIdentity}/formation/${type}`, {
    body,
  })
  return response.json() as Promise<Formation>
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
