import type {HerokuApiClientOptions} from '@heroku/heroku-fetch'
import type {HerokuClient} from '@heroku/types/repositories'

import * as routes from '@heroku/types/repositories/routes'

import type {RoutesClientExtras} from '../core/create-client.js'

import {createClient} from '../core/create-client.js'

export type RepositoriesClient = HerokuClient & RoutesClientExtras<HerokuClient>

/**
 * heroku-fetch's `repositories` service supplies the kolkrabbi host
 * (`HEROKU_REPOSITORIES_HOST`, else `https://kolkrabbi.heroku.com`) and sends no
 * Accept default. Caller options, including `baseUrl` and `service`, win.
 */
export function createRepositoriesClient(options: HerokuApiClientOptions = {}): RepositoriesClient {
  return createClient<HerokuClient>(routes, {service: 'repositories', ...options})
}
