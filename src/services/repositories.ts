/// <reference types="node" />
import type {HerokuApiClientOptions} from '@heroku/heroku-fetch'
import type {HerokuClient} from '@heroku/types/repositories'

import * as routes from '@heroku/types/repositories/routes'

import type {RoutesClientExtras} from '../core/create-client.js'

import {createClient} from '../core/create-client.js'

export type RepositoriesClient = HerokuClient & RoutesClientExtras<HerokuClient>

const DEFAULT_REPOSITORIES_BASE_URL = 'https://kolkrabbi.heroku.com'

export function createRepositoriesClient(options: HerokuApiClientOptions = {}): RepositoriesClient {
  const baseUrl = process.env.HEROKU_REPOSITORIES_HOST ?? DEFAULT_REPOSITORIES_BASE_URL
  return createClient<HerokuClient>(routes, {
    baseUrl,
    service: 'custom',
    ...options,
  })
}
