import type {HerokuApiClientOptions} from '@heroku/api-client'
import type {Formation, FormationBatchUpdateOpts} from '@heroku/types/3.sdk'

import type {ResourceCtx} from '../core/extend-resource.js'

import * as dynoResource from '../resources/platform/dyno.js'
import {createDataClient} from '../services/data.js'
import {createPlatformClient} from '../services/platform.js'

export type DynoOptions = {
  clientOptions?: HerokuApiClientOptions
  signal?: AbortSignal
}

export type ScaleDynosUpdate = dynoResource.ScaleDynosUpdate
export type RestartDynosTarget = dynoResource.RestartDynosTarget

function makeCtx(options: DynoOptions): ResourceCtx {
  let platform: ReturnType<typeof createPlatformClient> | undefined
  let data: ReturnType<typeof createDataClient> | undefined
  return {
    get data() {
      data ??= createDataClient(options.clientOptions)
      return data
    },
    get platform() {
      platform ??= createPlatformClient(options.clientOptions)
      return platform
    },
  }
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
  if (Array.isArray(updates)) {
    return dynoResource.scaleDynos(makeCtx(options), appIdentity, updates, {signal: options.signal})
  }

  return dynoResource.scaleDynos(makeCtx(options), appIdentity, updates, {signal: options.signal})
}

export async function restartDynos(
  appIdentity: string,
  target?: RestartDynosTarget,
  options: DynoOptions = {},
): Promise<void> {
  await dynoResource.restartDynos(makeCtx(options), appIdentity, target, {signal: options.signal})
}
