import type {HerokuApiClientOptions} from '@heroku/heroku-fetch'
import type {App} from '@heroku/types/3.sdk'

import {createPlatformClient} from '../services/platform.js'

export type AppOptions = {
  clientOptions?: HerokuApiClientOptions
  signal?: AbortSignal
}

export async function enableMaintenanceMode(
  appIdentity: string,
  options: AppOptions = {},
): Promise<App> {
  options.signal?.throwIfAborted()
  const client = createPlatformClient(options.clientOptions)
  return client.app.update(appIdentity, {maintenance: true})
}

export async function disableMaintenanceMode(
  appIdentity: string,
  options: AppOptions = {},
): Promise<App> {
  options.signal?.throwIfAborted()
  const client = createPlatformClient(options.clientOptions)
  return client.app.update(appIdentity, {maintenance: false})
}
