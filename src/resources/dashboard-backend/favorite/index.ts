import type {FavoriteOptions} from './add-by-app-name.js'

import {extendResource} from '../../../core/extend-resource.js'
import {addByAppName} from './add-by-app-name.js'
import {removeByAppName} from './remove-by-app-name.js'

export {addByAppName, type FavoriteOptions} from './add-by-app-name.js'
export {
  AlreadyFavoriteError, AppNotFoundError, FavoriteCreateError, NotFavoriteError,
} from './errors.js'
export {removeByAppName} from './remove-by-app-name.js'

export const favoriteExtensions = extendResource('dashboardBackend', 'favorite', ctx => ({
  addByAppName: (appName: string, options?: FavoriteOptions) => addByAppName(ctx, appName, options),
  removeByAppName: (appName: string, options?: FavoriteOptions) => removeByAppName(ctx, appName, options),
}))
