import type {HerokuApiClientOptions} from '@heroku/heroku-fetch'
import type {HerokuClient} from '@heroku/types/3.sdk'

import * as routes from '@heroku/types/3.sdk/routes'

import type {RoutesClientExtras} from '../core/create-client.js'

import {createClient} from '../core/create-client.js'

export type PlatformClient = HerokuClient & RoutesClientExtras<HerokuClient>

/**
 * The Platform API variant this client's routes and types are generated from
 * (`@heroku/types/3.sdk`). Dispatch at the same variant so the wire matches the
 * shipped types — otherwise `3.sdk`-only routes (e.g. `buildMetadata.info`) 404
 * under heroku-fetch's shared `version=3` default, and fields the types describe
 * in their `3.sdk` shape (e.g. `App.generation: string`) arrive in the older
 * `version=3` shape. A caller can still override per request via `withHeaders`,
 * or per client by passing their own `defaultAccept`.
 */
const PLATFORM_SDK_ACCEPT = 'application/vnd.heroku+json; version=3.sdk'

export function createPlatformClient(options: HerokuApiClientOptions = {}): PlatformClient {
  return createClient<HerokuClient>(routes, {
    defaultAccept: PLATFORM_SDK_ACCEPT,
    service: 'platform',
    ...options,
  })
}
