import type {HerokuApiClientOptions} from '@heroku/heroku-fetch'
import type {HerokuClient} from '@heroku/types/3.sdk'

import * as routes from '@heroku/types/3.sdk/routes'

import type {RoutesClientExtras} from '../core/create-client.js'

import {createClient} from '../core/create-client.js'

export type PlatformClient = HerokuClient & RoutesClientExtras<HerokuClient>

export function createPlatformClient(options: HerokuApiClientOptions = {}): PlatformClient {
  return createClient<HerokuClient>(routes, {service: 'platform', ...options})
}
