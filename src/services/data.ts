import type {HerokuApiClientOptions} from '@heroku/api-client'
import type {HerokuClient as DataClient} from '@heroku/types/data'

import * as routes from '@heroku/types/data/routes'

import {createClient} from '../core/create-client.js'

export type {DataClient}

export function createDataClient(options: HerokuApiClientOptions = {}): DataClient {
  return createClient<DataClient>(routes, {service: 'data', ...options})
}
