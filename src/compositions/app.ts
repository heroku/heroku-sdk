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

/**
 * @deprecated Use `sdk.platform.app.enableMaintenance` from `@heroku/sdk/sdk` with
 * `appExtensions` from `@heroku/sdk/extensions/platform`, or import `enableMaintenance`
 * directly from `@heroku/sdk/resources/platform/app`.
 */
export async function enableMaintenanceMode(
  appIdentity: string,
  options: AppOptions = {},
): Promise<App> {
  return appResource.enableMaintenance(makeCtx(options), appIdentity, {signal: options.signal})
}

/**
 * @deprecated Use `sdk.platform.app.disableMaintenance` from `@heroku/sdk/sdk` with
 * `appExtensions` from `@heroku/sdk/extensions/platform`, or import `disableMaintenance`
 * directly from `@heroku/sdk/resources/platform/app`.
 */
export async function disableMaintenanceMode(
  appIdentity: string,
  options: AppOptions = {},
): Promise<App> {
  return appResource.disableMaintenance(makeCtx(options), appIdentity, {signal: options.signal})
}
