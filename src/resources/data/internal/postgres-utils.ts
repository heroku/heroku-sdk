import type {AddOn} from '@heroku/types/3.sdk'

import createDebug from 'debug'

import {ResourceCtx} from '../../../core/extend-resource.js'

const debug = createDebug('postgres-utils')

/**
 * Returns an arbitrary legacy database add-on based on the provided app name.
 */
export async function getArbitraryLegacyDB(
  ctx: Pick<ResourceCtx, 'platform'>,
  appIdentity: string,
): Promise<AddOn> {
  debug(`fetching arbitrary legacy database on ${appIdentity}`)

  const addons = await ctx.platform.addOn.listByApp(appIdentity)
  const addon = addons.find(a => a.app.name === appIdentity && isLegacyDatabase(a))

  if (!addon) throw new Error(`No Heroku Postgres legacy database on ${appIdentity}`)
  return addon
}

export const getAddonService = () =>
  process.env.HEROKU_POSTGRESQL_ADDON_NAME || process.env.HEROKU_DATA_SERVICE || 'heroku-postgresql'

export const isPostgresAddon = (addon: AddOn) =>
  addon.plan?.name?.split(':', 2)[0] === getAddonService()

export const isAdvancedDatabase = (addon: AddOn) =>
  isPostgresAddon(addon) && /^(advanced|performance)/.test(addon.plan?.name?.split(':', 2)[1] ?? '')

export const isLegacyDatabase = (addon: AddOn) =>
  isPostgresAddon(addon) && !isAdvancedDatabase(addon)
