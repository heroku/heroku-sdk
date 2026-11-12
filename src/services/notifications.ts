import type {HerokuApiClientOptions} from '@heroku/heroku-fetch'
import type {HerokuClient} from '@heroku/types/notifications'

import * as routes from '@heroku/types/notifications/routes'

import type {RoutesClientExtras} from '../core/create-client.js'

import {createClient} from '../core/create-client.js'

export type NotificationsClient = HerokuClient & RoutesClientExtras<HerokuClient>

/**
 * heroku-fetch's `notifications` service supplies the telex host
 * (`HEROKU_NOTIFICATIONS_HOST`, else `https://telex.heroku.com`) and sends no Accept
 * default. Caller options, including `baseUrl` and `service`, win.
 */
export function createNotificationsClient(options: HerokuApiClientOptions = {}): NotificationsClient {
  return createClient<HerokuClient>(routes, {service: 'notifications', ...options})
}
