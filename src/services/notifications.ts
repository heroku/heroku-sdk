/// <reference types="node" />
import type {HerokuApiClientOptions} from '@heroku/heroku-fetch'
import type {HerokuClient} from '@heroku/types/notifications'

import * as routes from '@heroku/types/notifications/routes'

import type {RoutesClientExtras} from '../core/create-client.js'

import {createClient} from '../core/create-client.js'

export type NotificationsClient = HerokuClient & RoutesClientExtras<HerokuClient>

const DEFAULT_NOTIFICATIONS_BASE_URL = 'https://telex.heroku.com'

export function createNotificationsClient(options: HerokuApiClientOptions = {}): NotificationsClient {
  const baseUrl = process.env.HEROKU_NOTIFICATIONS_HOST ?? DEFAULT_NOTIFICATIONS_BASE_URL
  return createClient<HerokuClient>(routes, {
    baseUrl,
    service: 'custom',
    ...options,
  })
}
