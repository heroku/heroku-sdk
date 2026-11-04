import type {AddOn} from '@heroku/types/3.sdk'

import {PostgresCredentialInfoResult as AdvancedCredentialInfo} from '@heroku/types/data'
import createDebug from 'debug'

import type {ResourceCtx} from '../../../core/extend-resource.js'
import type {ResolvedAddOnAttachment} from '../../platform/add-on-attachment/resolve.js'

import {CredentialInfo as NonAdvancedCredentialInfo} from '../postgres-database.js'

const debug = createDebug('heroku:sdk:resources:postgres-database')

/**
 * The add-on shapes the Postgres tier predicates accept: either a full
 * platform `AddOn` or the lighter add-on carried on a resolved attachment.
 * Both expose the `plan.name` these checks read, so they're interchangeable
 * here.
 */
export type PostgresAddonLike = AddOn | ResolvedAddOnAttachment['addon']

/**
 * Thrown when an add-on is not an Advanced-tier database. Carries the add-on
 * so callers that need its identity don't need a second resolve call.
 */
export class NotAdvancedDatabaseError extends Error {
  public readonly id = 'not_advanced_database'

  constructor(public readonly addon: PostgresAddonLike, message: string) {
    super(message)
    this.name = 'NotAdvancedDatabaseError'
  }

  public get body() {
    return {id: this.id, message: this.message}
  }
}

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

export const isPostgresAddon = (addon: PostgresAddonLike) =>
  addon.plan?.name?.split(':', 2)[0] === getPostgresServiceName()

export const isAdvancedDatabase = (addon: PostgresAddonLike) =>
  isPostgresAddon(addon) && /^(advanced|performance)/.test(addon.plan?.name?.split(':', 2)[1] ?? '')

export const isLegacyDatabase = (addon: PostgresAddonLike) =>
  isPostgresAddon(addon) && !isAdvancedDatabase(addon)

export const isLegacyEssentialDatabase = (addon: PostgresAddonLike) =>
  isLegacyDatabase(addon) && /^(dev|basic|mini)/.test(addon.plan?.name?.split(':', 2)[1] ?? '')

export const isEssentialDatabase = (addon: PostgresAddonLike) =>
  isLegacyDatabase(addon) && (addon.plan?.name?.split(':', 2)[1] ?? '').startsWith('essential')

export const isEssentialTier = (addon: PostgresAddonLike) =>
  isEssentialDatabase(addon) || isLegacyEssentialDatabase(addon)
