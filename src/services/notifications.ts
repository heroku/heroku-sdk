import type {HerokuApiClientOptions} from '@heroku/heroku-fetch'
import type {HerokuClient} from '@heroku/types/notifications'

import * as routes from '@heroku/types/notifications/routes'

import type {RoutesClientExtras} from '../core/create-client.js'

import {createClient} from '../core/create-client.js'

export type NotificationsClient = HerokuClient & RoutesClientExtras<HerokuClient>

export function createNotificationsClient(options: HerokuApiClientOptions = {}): NotificationsClient {
  return createClient<HerokuClient>(routes, {service: 'notifications', ...options})
}
