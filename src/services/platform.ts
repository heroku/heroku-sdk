import type {HerokuApiClientOptions} from '@heroku/heroku-fetch'
import type {HerokuClient} from '@heroku/types/3.sdk'

import * as routes from '@heroku/types/3.sdk/routes'

import type {RoutesClientExtras} from '../core/create-client.js'

import {createClient} from '../core/create-client.js'
import {platformBaseUrlFromEnv} from '../core/heroku-host.js'

export type PlatformClient = HerokuClient & RoutesClientExtras<HerokuClient>

export function createPlatformClient(options: HerokuApiClientOptions = {}): PlatformClient {
  // Honor HEROKU_HOST (staging/custom Heroku environments) the same way the CLI
  // does, so SDK-based commands and the CLI agree on the target host. When it is
  // unset, `baseUrl` is undefined and heroku-fetch falls back to its production
  // `SERVICE_CONFIGS.platform` default. `baseUrl` lands before `...options` so an
  // explicit caller-supplied `baseUrl` still wins.
  const baseUrl = platformBaseUrlFromEnv()
  return createClient<HerokuClient>(routes, {baseUrl, service: 'platform', ...options})
}
