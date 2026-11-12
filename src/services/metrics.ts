import type {HerokuApiClientOptions} from '@heroku/heroku-fetch'
import type {HerokuClient} from '@heroku/types/metrics'

import * as routes from '@heroku/types/metrics/routes'

import type {RoutesClientExtras} from '../core/create-client.js'

import {createClient} from '../core/create-client.js'

export type MetricsClient = HerokuClient & RoutesClientExtras<HerokuClient>

/**
 * heroku-fetch's `metrics` service supplies the host (`HEROKU_METRICS_HOST`, else
 * `https://api.metrics.heroku.com`) and the Heroku v3 Accept default. Caller
 * options, including `baseUrl`, `service` and `headers`, win.
 */
export function createMetricsClient(options: HerokuApiClientOptions = {}): MetricsClient {
  return createClient<HerokuClient>(routes, {service: 'metrics', ...options})
}
