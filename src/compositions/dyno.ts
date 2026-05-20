import type {HerokuApiClientOptions} from '@heroku/heroku-fetch'
import type {
  Formation,
  FormationBatchUpdateOpts,
  FormationUpdateOpts,
} from '@heroku/types/3.sdk'

import {createPlatformClient} from '../services/platform.js'

export type DynoOptions = {
  clientOptions?: HerokuApiClientOptions
  signal?: AbortSignal
}

export type ScaleDynosUpdate = FormationUpdateOpts & {
  type: string
}

export type RestartDynosTarget
  = | {dyno: string}
  | {type: string}

export function scaleDynos(
  appIdentity: string,
  updates: ScaleDynosUpdate,
  options?: DynoOptions,
): Promise<Formation>
export function scaleDynos(
  appIdentity: string,
  updates: FormationBatchUpdateOpts['updates'],
  options?: DynoOptions,
): Promise<Formation[]>
export async function scaleDynos(
  appIdentity: string,
  updates: FormationBatchUpdateOpts['updates'] | ScaleDynosUpdate,
  options: DynoOptions = {},
): Promise<Formation | Formation[]> {
  options.signal?.throwIfAborted()
  const client = createPlatformClient(options.clientOptions)

  if (Array.isArray(updates)) {
    return client.formation.batchUpdate(appIdentity, {updates})
  }

  const {type, ...body} = updates
  return client.formation.update(appIdentity, type, body)
}

export async function restartDynos(
  appIdentity: string,
  target?: RestartDynosTarget,
  options: DynoOptions = {},
): Promise<void> {
  options.signal?.throwIfAborted()
  const client = createPlatformClient(options.clientOptions)

  if (!target) {
    await client.dyno.restartAll(appIdentity)
    return
  }

  if ('dyno' in target) {
    await client.dyno.restart(appIdentity, target.dyno)
    return
  }

  await client.dyno.restartFormation(appIdentity, target.type)
}
