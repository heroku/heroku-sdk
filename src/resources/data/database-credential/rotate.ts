import type {
  PostgresDatabaseInfoCredentialResult as NonAdvancedCredentialInfo,
  PostgresCredentialListResult,
  PostgresDatabaseRotateCredentialResult,
  PostgresDatabaseRotateCredentialsResult,
  PostgresRotateCredentialsResult,
} from '@heroku/types/data'

import {AddOnAttachment} from '@heroku/types/3.sdk'

import type {ResourceCtx} from '../../../core/extend-resource.js'
import type {ResolvedAddOn} from '../../platform/add-on/types.js'
import type {DatabaseCredentialOptions} from './index.js'

import {withSignal} from '../../../core/with-signal.js'
import {resolveAddonInternal} from '../../platform/add-on/resolve.js'
import {
  getPostgresServiceName, isAdvancedDatabase, isEssentialDatabase, isLegacyEssentialDatabase,
} from '../internal/postgres-utils.js'

type AdvancedCredentialInfo = PostgresCredentialListResult['items'][number]

export type RotateDatabaseCredentialOptions = DatabaseCredentialOptions & {
  /**
   * Fires before the rotate request, allowing the caller to perform any
   * necessary pre-rotation checks or UI rendering.
   */
  beforeRotate?: (preview: RotateDatabaseCredentialPreview) => Promise<void> | void
}

export type RotateDatabaseCredentialOpts = {
  /** Rotate every credential on the database instead of a single one. */
  all?: boolean
  /** Name of the credential to rotate. Defaults to owner or default credential. */
  credName?: string
  /** Immediately kill connections using the credential(s) being rotated. */
  forced?: boolean
}

/**
 * Resolved state of a rotation, passed to `beforeRotate` before the request
 * is sent: the add-on, the credential that will rotate, the owner and default
 * credentials, whether the database is Advanced or Essential tier, and the
 * add-on's attachments.
 */
export type RotateDatabaseCredentialPreview = {
  addon: ResolvedAddOn
  attachments: AddOnAttachment[]
  credToRotate?: AdvancedCredentialInfo | NonAdvancedCredentialInfo
  defaultCred?: NonAdvancedCredentialInfo
  isAdvancedTier: boolean
  isEssentialTier: boolean
  ownerCred?: AdvancedCredentialInfo
}

export type RotateAllDatabaseCredentialsResult = {
  addon: ResolvedAddOn
  credentials: PostgresDatabaseRotateCredentialsResult | PostgresRotateCredentialsResult
}

export type RotateDatabaseCredentialResult = {
  addon: ResolvedAddOn
  credential: PostgresDatabaseRotateCredentialResult | void
}

/**
 * Rotates one or all credentials on a Postgres database, dispatching to the
 * Advanced-tier or classic-tier endpoint based on the resolved add-on's plan.
 *
 * Essential and legacy Essential-tier databases don't support named-credential
 * rotation.
 */
export async function rotate(
  ctx: Pick<ResourceCtx, 'data' | 'platform'>,
  addonIdentity: string,
  body: RotateDatabaseCredentialOpts & {all: true},
  options?: RotateDatabaseCredentialOptions,
): Promise<RotateAllDatabaseCredentialsResult>
export async function rotate(
  ctx: Pick<ResourceCtx, 'data' | 'platform'>,
  addonIdentity: string,
  body?: RotateDatabaseCredentialOpts,
  options?: RotateDatabaseCredentialOptions,
): Promise<RotateDatabaseCredentialResult>

export async function rotate(
  ctx: Pick<ResourceCtx, 'data' | 'platform'>,
  addonIdentity: string,
  body: RotateDatabaseCredentialOpts = {},
  options: RotateDatabaseCredentialOptions = {},
): Promise<RotateAllDatabaseCredentialsResult | RotateDatabaseCredentialResult> {
  const {appIdentity, beforeRotate, signal} = options
  signal?.throwIfAborted()
  // Bind the signal so the resolve and rotate requests abort in flight.
  const platform = withSignal(ctx.platform, signal)
  const addon = await resolveAddonInternal(platform, addonIdentity, {
    addonService: getPostgresServiceName(), appIdentity,
  })

  const {all, credName, forced} = body

  const isAdvancedTier = isAdvancedDatabase(addon)
  // Check for essential tier only; legacy Essential-tier databases
  // get their own message below and are otherwise treated like
  // any other classic-tier database for credential selection.
  const isEssentialTier = isEssentialDatabase(addon)

  if (!isAdvancedTier && credName && credName !== 'default') {
    if (isLegacyEssentialDatabase(addon)) {
      throw new Error('Legacy Essential-tier databases do not support named credentials.')
    }

    if (isEssentialTier) {
      throw new Error('Essential-tier databases do not support named credentials.')
    }
  }

  const data = withSignal(ctx.data, signal)

  const attachments = await platform.addOnAttachment.listByAddOn(addon.id)

  let ownerCred: AdvancedCredentialInfo | undefined
  let defaultCred: NonAdvancedCredentialInfo | undefined
  let credToRotate: AdvancedCredentialInfo | NonAdvancedCredentialInfo | undefined

  if (isAdvancedTier) {
    const {items: availableCreds} = await data.postgresCredential.list(addon.id)
    ownerCred = availableCreds.find(cred => cred.type === 'owner')
    credToRotate = credName
      ? availableCreds.find(cred => cred.name === credName)
      : ownerCred
  } else {
    const availableCreds = await data.postgresDatabase.listCredentials(addon.id) as unknown as NonAdvancedCredentialInfo[]
    defaultCred = isEssentialTier
      ? availableCreds[0]
      : availableCreds.find(cred => cred.name === 'default')
    credToRotate = credName && !isEssentialTier
      ? availableCreds.find(cred => cred.name === credName)
      : defaultCred
  }

  await beforeRotate?.({
    addon,
    attachments,
    credToRotate,
    defaultCred,
    isAdvancedTier,
    isEssentialTier,
    ownerCred,
  })
  signal?.throwIfAborted()

  if (all) {
    const credentials = await (isAdvancedTier
      ? data.postgres.rotateCredentials(addon.id, {forced})
      : data.postgresDatabase.rotateCredentials(addon.id, {forced}))
    return {addon, credentials}
  }

  const finalCredName = isEssentialTier ? 'default' : credToRotate?.name
  if (!finalCredName) {
    throw new Error(`There are no credentials on the database ${addon.name}.`)
  }

  const credential = await (isAdvancedTier
    ? data.postgresCredential.rotate(addon.id, finalCredName, {forced})
    : data.postgresDatabase.rotateCredential(addon.id, finalCredName, {forced}))

  return {addon, credential}
}
