import type {HerokuApiClientOptions} from '@heroku/api-client'
import type {HerokuClient as PlatformClient} from '@heroku/types/3.sdk'

import * as routes from '@heroku/types/3.sdk/routes'

import {createClient} from '../core/create-client.js'

export function createPlatformClient(options: HerokuApiClientOptions = {}): PlatformClient {
  return createClient<PlatformClient>(routes, {service: 'platform', ...options})
}

export {type HerokuClient as PlatformClient} from '@heroku/types/3.sdk'
