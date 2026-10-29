import type {FavoriteListResult} from '@heroku/types/dashboard-backend'

import type {ResourceCtx} from '../../../core/extend-resource.js'
import type {FavoriteOptions} from './add-by-app-name.js'

import {withSignal} from '../../../core/with-signal.js'
import {NotFavoriteError} from './errors.js'

/** Remove an app from the current user's favorites by its exact app name. */
export async function removeByAppName(
  ctx: Pick<ResourceCtx, 'dashboardBackend'>,
  appName: string,
  options: FavoriteOptions = {},
): Promise<void> {
  const {signal} = options
  signal?.throwIfAborted()

  const dashboardBackend = withSignal(ctx.dashboardBackend, signal)
  const favorites = await dashboardBackend.favorite.list({type: 'app'}) as FavoriteListResult

  signal?.throwIfAborted()

  const favorite = favorites.find(candidate => candidate.resource_name === appName)
  if (!favorite) {
    throw new NotFavoriteError(appName)
  }

  await dashboardBackend.favorite.delete(favorite.id)
}
