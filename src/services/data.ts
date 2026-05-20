import type {HerokuApiClientOptions} from '@heroku/heroku-fetch'
import type {HerokuClient as DataClient} from '@heroku/types/data'

import * as routes from '@heroku/types/data/routes'

import {createClient} from '../core/create-client.js'

export function createDataClient(options: HerokuApiClientOptions = {}): DataClient {
  return createClient<DataClient>(routes, {service: 'data', ...options})
}

export {type HerokuClient as DataClient} from '@heroku/types/data'
