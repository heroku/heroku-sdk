import type {HerokuApiClientOptions} from '@heroku/api-client'
import type {App} from '@heroku/types/3.sdk'

import type {ResourceCtx} from '../core/extend-resource.js'

import * as appResource from '../resources/platform/app.js'
import {createDataClient} from '../services/data.js'
import {createPlatformClient} from '../services/platform.js'

export type AppOptions = {
  clientOptions?: HerokuApiClientOptions
  signal?: AbortSignal
}

function makeCtx(options: AppOptions): ResourceCtx {
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

export async function enableMaintenanceMode(
  appIdentity: string,
  options: AppOptions = {},
): Promise<App> {
  return appResource.enableMaintenance(makeCtx(options), appIdentity, {signal: options.signal})
}

export async function disableMaintenanceMode(
  appIdentity: string,
  options: AppOptions = {},
): Promise<App> {
  return appResource.disableMaintenance(makeCtx(options), appIdentity, {signal: options.signal})
}
