import type {ResolveRedisByAppOptions} from './resolve-by-app.js'
import type {WaitForRedisReadyOptions} from './wait-for-ready.js'

import {extendResource} from '../../../core/extend-resource.js'
import {resolveRedisByApp} from './resolve-by-app.js'
import {waitForRedisReady} from './wait-for-ready.js'

export {RedisAddonAmbiguousError, RedisAddonNotFoundError} from './errors.js'
export {resolveRedisByApp, type ResolveRedisByAppOptions} from './resolve-by-app.js'
export {waitForRedisReady, type WaitForRedisReadyOptions} from './wait-for-ready.js'

export const redisExtensions = extendResource('data', 'redis', ctx => ({
  resolveByApp: (appIdentity: string, options?: ResolveRedisByAppOptions) =>
    resolveRedisByApp(ctx, appIdentity, options),
  waitForReady: (nameOrId: string, options?: WaitForRedisReadyOptions) =>
    waitForRedisReady(ctx, nameOrId, options),
}))
