/// <reference types="node" />
import type {HerokuApiClientOptions} from '@heroku/heroku-fetch'
import type {HerokuClient} from '@heroku/types/metrics'

import * as routes from '@heroku/types/metrics/routes'

import type {RoutesClientExtras} from '../core/create-client.js'

import {createClient} from '../core/create-client.js'

export type MetricsClient = HerokuClient & RoutesClientExtras<HerokuClient>

const DEFAULT_METRICS_BASE_URL = 'https://api.metrics.heroku.com'

export function createMetricsClient(options: HerokuApiClientOptions = {}): MetricsClient {
  const baseUrl = process.env.HEROKU_METRICS_HOST ?? DEFAULT_METRICS_BASE_URL
  // Metrics is a distinct host that heroku-fetch does not model as a first-class
  // service, so we use `service: 'custom'` with an explicit base URL. Auth (bearer
  // token) is resolved by heroku-fetch exactly as for platform/data — same
  // HEROKU_API_KEY / netrc source, shared across services on one SDK instance.
  //
  // Unlike platform/data, `service: 'custom'` sends no default Accept header, so we
  // set `application/vnd.heroku+json; version=3` explicitly to match what meetas
  // expects — the same versioned vendor type platform/data get automatically via
  // heroku-fetch's `defaultAccept`. A caller can still override it via `headers`:
  // `...options` first, then an explicit `headers` key whose `...options.headers`
  // spread lands AFTER the literal Accept, so caller headers win for any key they set.
  return createClient<HerokuClient>(routes, {
    baseUrl,
    service: 'custom',
    ...options,
    headers: {Accept: 'application/vnd.heroku+json; version=3', ...options.headers},
  })
}
