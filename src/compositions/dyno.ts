import type {HerokuApiClientOptions} from '@heroku/api-client'
import type {
  Dyno,
  Formation,
  FormationBatchUpdateOpts,
  FormationUpdateOpts,
} from '@heroku/types/3.sdk'

import {createHerokuClient} from '../core/create-client.js'

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

export async function listDynos(
  appIdentity: string,
  options: DynoOptions = {},
): Promise<Dyno[]> {
  options.signal?.throwIfAborted()
  const client = createHerokuClient(options.clientOptions)
  return client.dyno.list(appIdentity)
}

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
  const client = createHerokuClient(options.clientOptions)

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
  const client = createHerokuClient(options.clientOptions)

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
