/// <reference types="node" />
import type {HerokuApiClientOptions} from '@heroku/heroku-fetch'
import type {HerokuClient} from '@heroku/types/dashboard-backend'

import * as routes from '@heroku/types/dashboard-backend/routes'

import type {RoutesClientExtras} from '../core/create-client.js'

import {createClient} from '../core/create-client.js'

export type DashboardBackendClient = HerokuClient & RoutesClientExtras<HerokuClient>

const DEFAULT_DASHBOARD_BACKEND_BASE_URL = 'https://particleboard.heroku.com'

export function createDashboardBackendClient(options: HerokuApiClientOptions = {}): DashboardBackendClient {
  const baseUrl = process.env.HEROKU_PARTICLEBOARD_HOST ?? DEFAULT_DASHBOARD_BACKEND_BASE_URL
  return createClient<HerokuClient>(routes, {
    baseUrl,
    service: 'particleboard',
    ...options,
  })
}
