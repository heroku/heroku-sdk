import type {HerokuApiClientOptions} from '@heroku/heroku-fetch'
import type {HerokuClient} from '@heroku/types/repositories'

import * as routes from '@heroku/types/repositories/routes'

import type {RoutesClientExtras} from '../core/create-client.js'

import {createClient} from '../core/create-client.js'

export type RepositoriesClient = HerokuClient & RoutesClientExtras<HerokuClient>

export function createRepositoriesClient(options: HerokuApiClientOptions = {}): RepositoriesClient {
  return createClient<HerokuClient>(routes, {service: 'repositories', ...options})
}
