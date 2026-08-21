/// <reference types="node" />
import type {HerokuApiClientOptions} from '@heroku/heroku-fetch'
import type {HerokuClient} from '@heroku/types/dashboard-backend'

import * as routes from '@heroku/types/dashboard-backend/routes'

import type {RoutesClientExtras} from '../core/create-client.js'

import {createClient} from '../core/create-client.js'

export type DashboardBackendClient = HerokuClient & RoutesClientExtras<HerokuClient>

export function createDashboardBackendClient(options: HerokuApiClientOptions = {}): DashboardBackendClient {
  const baseUrl = process.env.HEROKU_PARTICLEBOARD_URL
  return createClient<HerokuClient>(routes, {
    service: 'particleboard',
    ...(baseUrl && {baseUrl}),
    ...options,
  })
}
