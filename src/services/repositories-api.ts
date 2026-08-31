import type {HerokuApiClientOptions} from '@heroku/heroku-fetch'
import type {HerokuClient} from '@heroku/types/repositories-api'

import * as routes from '@heroku/types/repositories-api/routes'

import type {RoutesClientExtras} from '../core/create-client.js'

import {createClient} from '../core/create-client.js'

export type RepositoriesApiClient = HerokuClient & RoutesClientExtras<HerokuClient>

const REPOSITORIES_API_ACCEPT = 'application/vnd.heroku+json; version=3.repositories-api'

export function createRepositoriesApiClient(options: HerokuApiClientOptions = {}): RepositoriesApiClient {
  return createClient<HerokuClient>(routes, {
    defaultAccept: REPOSITORIES_API_ACCEPT,
    service: 'platform',
    ...options,
  })
}
