import type {HerokuApiClientOptions} from '@heroku/heroku-fetch'
import type {HerokuClient} from '@heroku/types/dashboard-backend'

import * as routes from '@heroku/types/dashboard-backend/routes'

import type {RoutesClientExtras} from '../core/create-client.js'

import {createClient} from '../core/create-client.js'

export type DashboardBackendClient = HerokuClient & RoutesClientExtras<HerokuClient>

/**
 * heroku-fetch's `particleboard` service supplies the host
 * (`HEROKU_PARTICLEBOARD_URL`, else `https://particleboard.heroku.com`) and the Heroku
 * v3 Accept default. Caller options, including `baseUrl` and `service`, win.
 */
export function createDashboardBackendClient(options: HerokuApiClientOptions = {}): DashboardBackendClient {
  return createClient<HerokuClient>(routes, {service: 'particleboard', ...options})
}
