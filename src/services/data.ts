import type {HerokuApiClientOptions} from '@heroku/heroku-fetch'
import type {HerokuClient} from '@heroku/types/data'

import * as routes from '@heroku/types/data/routes'

import type {RoutesClientExtras} from '../core/create-client.js'

import {createClient} from '../core/create-client.js'

export type DataClient = HerokuClient & RoutesClientExtras<HerokuClient>

export function createDataClient(options: HerokuApiClientOptions = {}): DataClient {
  return createClient<HerokuClient>(routes, {service: 'data', ...options})
}
