import type {AddOn} from '@heroku/types/3.sdk'

import createDebug from 'debug'

import type {ResourceCtx} from '../../../core/extend-resource.js'
import type {ResolvedAddOn} from '../../platform/add-on/index.js'

import {RedisAddonAmbiguousError, RedisAddonNotFoundError} from './errors.js'

const debug = createDebug('heroku:sdk:resources:redis')

const DEFAULT_REDIS_ADDON_SERVICE_PREFIX = 'heroku-redis'

export type ResolveRedisByAppOptions = {
  /**
   * Override the add-on service prefix used to identify a redis add-on
   * on the app. Defaults to `heroku-redis`. The match is a prefix
   * (`startsWith`) on `addon_service.name`, matching the CLI's existing
   * `makeAddonsFilter` semantics.
   */
  addonServiceName?: string
  /**
   * Optional filter narrowing the app's redis add-ons to a single
   * database. Matched case-insensitively against the add-on's `name`
   * and each of its `config_vars`, using substring containment. This
   * mirrors the CLI's `makeAddonsFilter` behavior so migrating callers
   * observe identical resolution semantics.
   */
  database?: string
  signal?: AbortSignal
}

/**
 * Resolve a redis add-on attached to `appIdentity`.
 *
 * Lists the app's add-ons, filters them to those whose
 * `addon_service.name` starts with `heroku-redis` (or the caller's
 * `addonServiceName`), and further narrows by the optional `database`
 * filter using the same case-insensitive substring match the CLI has
 * always used.
 *
 * Throws `RedisAddonNotFoundError` if no add-ons remain after filtering,
 * `RedisAddonAmbiguousError` if more than one remains. Both subclass the
 * generic add-on errors so callers doing `instanceof AddonNotFoundError`
 * still match.
 */
export async function resolveRedisByApp(
  ctx: Pick<ResourceCtx, 'platform'>,
  appIdentity: string,
  options: ResolveRedisByAppOptions = {},
): Promise<ResolvedAddOn> {
  options.signal?.throwIfAborted()

  const {addonServiceName = DEFAULT_REDIS_ADDON_SERVICE_PREFIX, database} = options
  const platform = options.signal ? ctx.platform.withOptions({signal: options.signal}) : ctx.platform

  debug('resolveByApp app=%s service-prefix=%s database=%s', appIdentity, addonServiceName, database ?? '<any>')
  const addons = await platform.addOn.listByApp(appIdentity)

  const filter = database?.toUpperCase()
  const matches = addons.filter(addon => {
    const service = addon.addon_service?.name
    if (!service || !service.startsWith(addonServiceName)) return false
    if (!filter) return true
    return matchesDatabaseFilter(addon, filter)
  })

  debug('resolveByApp app=%s candidates=%d matches=%d', appIdentity, addons.length, matches.length)

  if (matches.length === 0) {
    throw new RedisAddonNotFoundError()
  }

  if (matches.length > 1) {
    throw new RedisAddonAmbiguousError(matches)
  }

  const match = matches[0]
  if (!match.id || !match.app?.id) {
    throw new Error(`Resolved redis add-on is missing required fields (id=${match.id}, app.id=${match.app?.id})`)
  }

  return match as ResolvedAddOn
}

function matchesDatabaseFilter(addon: AddOn, filter: string): boolean {
  const configVars = addon.config_vars ?? []
  for (const configVar of configVars) {
    if (configVar.toUpperCase().includes(filter)) return true
  }

  if (addon.name && addon.name.toUpperCase().includes(filter)) return true
  return false
}
