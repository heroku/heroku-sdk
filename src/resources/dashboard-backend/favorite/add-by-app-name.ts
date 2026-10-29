/* eslint-disable camelcase -- Dashboard Backend favorite wire format */
import type {FavoriteCreateResult, FavoriteListResult} from '@heroku/types/dashboard-backend'

import type {ResourceCtx} from '../../../core/extend-resource.js'

import {withSignal} from '../../../core/with-signal.js'
import {isAbortError} from '../../../utils/is-abort-error.js'
import {AlreadyFavoriteError, AppNotFoundError, FavoriteCreateError} from './errors.js'

export type FavoriteOptions = {
  signal?: AbortSignal
}

/** Add an app to the current user's favorites by its exact app name. */
export async function addByAppName(
  ctx: Pick<ResourceCtx, 'dashboardBackend'>,
  appName: string,
  options: FavoriteOptions = {},
): Promise<FavoriteCreateResult | void> {
  const {signal} = options
  signal?.throwIfAborted()

  const dashboardBackend = withSignal(ctx.dashboardBackend, signal)
  const favorites = await dashboardBackend.favorite.list({type: 'app'}) as FavoriteListResult

  signal?.throwIfAborted()

  if (favorites.some(favorite => favorite.resource_name === appName)) {
    throw new AlreadyFavoriteError(appName)
  }

  try {
    return await dashboardBackend.favorite.create({resource_id: appName, type: 'app'})
  } catch (error: unknown) {
    // Preserve request cancellation, including custom abort reasons, but don't
    // let an unrelated abort race mask the create request's actual failure.
    if (isAbortError(error) || (signal?.aborted && error === signal.reason)) throw error

    if (isNotFound(error)) {
      throw new AppNotFoundError(appName, error)
    }

    throw new FavoriteCreateError(appName, error)
  }
}

function isNotFound(error: unknown): error is {statusCode: number} {
  return (
    typeof error === 'object'
    && error !== null
    && 'statusCode' in error
    && (error as {statusCode: unknown}).statusCode === 404
  )
}
