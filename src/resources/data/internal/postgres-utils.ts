import type {AddOn} from '@heroku/types/3.sdk'

import {PostgresCredentialInfoResult as AdvancedCredentialInfo} from '@heroku/types/data'
import createDebug from 'debug'

import type {ResourceCtx} from '../../../core/extend-resource.js'
import type {ResolvedAddOnAttachment} from '../../platform/add-on-attachment/resolve.js'

import {CredentialInfo as NonAdvancedCredentialInfo} from '../postgres-database.js'

const debug = createDebug('heroku:sdk:resources:postgres-database')

/**
 * Returns the first legacy database add-on on the app.
 */
export async function findLegacyDatabase(
  ctx: Pick<ResourceCtx, 'platform'>,
  appIdentity: string,
): Promise<AddOn> {
  debug(`fetching arbitrary legacy database on ${appIdentity}`)

  const addons = await ctx.platform.addOn.listByApp(appIdentity)
  const addon = addons.find(a => a.app.name === appIdentity && isLegacyDatabase(a))

  if (!addon) throw new Error(`No Heroku Postgres legacy database on ${appIdentity}`)
  return addon
}

export function isAdvancedCredential(credential: AdvancedCredentialInfo | NonAdvancedCredentialInfo): credential is AdvancedCredentialInfo {
  return 'roles' in credential
}

export const getPostgresServiceName = () =>
  process.env.HEROKU_POSTGRESQL_ADDON_NAME || process.env.HEROKU_DATA_SERVICE || 'heroku-postgresql'

export const isPostgresAddon = (addon: AddOn | ResolvedAddOnAttachment['addon']) =>
  addon.plan?.name?.split(':', 2)[0] === getPostgresServiceName()

export const isAdvancedDatabase = (addon: AddOn | ResolvedAddOnAttachment['addon']) =>
  isPostgresAddon(addon) && /^(advanced|performance)/.test(addon.plan?.name?.split(':', 2)[1] ?? '')

export const isLegacyDatabase = (addon: AddOn) =>
  isPostgresAddon(addon) && !isAdvancedDatabase(addon)

export const isLegacyEssentialDatabase = (addon: AddOn) =>
  isLegacyDatabase(addon) && /^(dev|basic|mini)/.test(addon.plan?.name?.split(':', 2)[1] ?? '')

export const isEssentialDatabase = (addon: AddOn) =>
  isLegacyDatabase(addon) && (addon.plan?.name?.split(':', 2)[1] ?? '').startsWith('essential')

export const isEssentialTier = (addon: AddOn) =>
  isEssentialDatabase(addon) || isLegacyEssentialDatabase(addon)
