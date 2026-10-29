import type {FavoriteCreateResult} from '@heroku/types/dashboard-backend'

import {HerokuSDK} from '@heroku/sdk'
import {favoriteExtensions} from '@heroku/sdk/extensions/dashboard-backend'

const sdk = new HerokuSDK({extensions: [favoriteExtensions] as const})

const addResult: Promise<FavoriteCreateResult | void> = sdk.dashboardBackend.favorite.addByAppName('example-app')
const addWithSignalResult: Promise<FavoriteCreateResult | void> = sdk.dashboardBackend.favorite.addByAppName(
  'example-app',
  {signal: new AbortController().signal},
)
const removeResult: Promise<void> = sdk.dashboardBackend.favorite.removeByAppName('example-app')
const removeWithSignalResult: Promise<void> = sdk.dashboardBackend.favorite.removeByAppName(
  'example-app',
  {signal: new AbortController().signal},
)

// @ts-expect-error App names must be strings.
sdk.dashboardBackend.favorite.addByAppName(42)
// @ts-expect-error Options only support an AbortSignal.
sdk.dashboardBackend.favorite.removeByAppName('example-app', {signal: 'not-an-abort-signal'})

export {
  addResult,
  addWithSignalResult,
  removeResult,
  removeWithSignalResult,
}
