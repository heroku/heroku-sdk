import type {
  PostgresDatabaseCreateCredentialsOpts,
  PostgresDatabaseCreateCredentialsResult,
  PostgresDatabaseDeleteCredentialResult,
  PostgresDatabaseRepairDefaultResult,
  PostgresDatabaseRotateCredentialResult,
  PostgresDatabaseRotateCredentialsResult,
} from '@heroku/types/data'

import type {ResourceCtx} from '../../../core/extend-resource.js'
import type {CredentialConnectionInfo} from '../database-credential/get-url.js'

import {withSignal} from '../../../core/with-signal.js'
import {isEssentialTier, isLegacyEssentialDatabase} from '../internal/postgres-utils.js'
import {type ResolvedPgDatabase, resolvePgDatabase} from '../internal/resolve-pg-database.js'

export type PostgresDatabaseCredentialOptions = {
  addonIdentity?: string
  signal?: AbortSignal
}

export type CreateCredentialsResult = {
  addon: ResolvedPgDatabase
  result: PostgresDatabaseCreateCredentialsResult
}

/**
 * Creates a credential on a classic-tier (Standard/Premium) Postgres
 * database. Throws if the resolved database is Essential-tier.
 */
export async function createCredentials(
  ctx: Pick<ResourceCtx, 'data' | 'platform'>,
  appIdentity: string,
  body: PostgresDatabaseCreateCredentialsOpts,
  options: PostgresDatabaseCredentialOptions = {},
): Promise<CreateCredentialsResult> {
  const {addonIdentity, signal} = options
  signal?.throwIfAborted()
  const addon = await resolvePgDatabase(ctx, appIdentity, {input: addonIdentity, signal})

  if (isEssentialTier(addon)) {
    throw new Error("You can't create a custom credential on Essential-tier databases.")
  }

  const data = withSignal(ctx.data, signal)
  const result = await data.postgresDatabase.createCredentials(addon.id, body)
  return {addon, result}
}

// The OpenAPI spec declares no fixed response schema for listCredentials
// (@heroku/types' PostgresDatabaseListCredentialsResult is `Record<string, unknown>`),
// so we use a custom type here.
export type CredentialInfo = {
  credentials: Array<{
    connections?: null | number
    password: string
    state: string
    user: string
  }>
  database: string
  host: string
  name: string
  port: number
  state: string
  uuid: string
}

export type ListCredentialsResult = {
  addon: ResolvedPgDatabase
  credentials: CredentialInfo[]
}

/**
 * Lists all credentials on a classic-tier (Essential/Standard/Premium)
 * Postgres database.
 */
export async function listCredentials(
  ctx: Pick<ResourceCtx, 'data' | 'platform'>,
  appIdentity: string,
  options: PostgresDatabaseCredentialOptions = {},
): Promise<ListCredentialsResult> {
  const {addonIdentity, signal} = options
  signal?.throwIfAborted()
  const addon = await resolvePgDatabase(ctx, appIdentity, {input: addonIdentity, signal})
  // Bind the signal so the request aborts in flight, not just during resolution.
  const data = withSignal(ctx.data, signal)
  const credentials = await data.postgresDatabase.listCredentials(addon.id) as unknown as CredentialInfo[]
  return {addon, credentials}
}

export type RepairDefaultResult = {
  addon: ResolvedPgDatabase
  result: PostgresDatabaseRepairDefaultResult
}

/**
 * Resets a classic-tier (Standard/Premium) Postgres database's default
 * credential permissions. Throws if the resolved database is Essential-tier.
 */
export async function repairDefault(
  ctx: Pick<ResourceCtx, 'data' | 'platform'>,
  appIdentity: string,
  options: PostgresDatabaseCredentialOptions = {},
): Promise<RepairDefaultResult> {
  const {addonIdentity, signal} = options
  signal?.throwIfAborted()
  const addon = await resolvePgDatabase(ctx, appIdentity, {input: addonIdentity, signal})

  if (isEssentialTier(addon)) {
    throw new Error("You can't perform this operation on Essential-tier databases.")
  }

  const data = withSignal(ctx.data, signal)
  const result = await data.postgresDatabase.repairDefault(addon.id)
  return {addon, result}
}

export type DeleteCredentialResult = {
  addon: ResolvedPgDatabase
  result: PostgresDatabaseDeleteCredentialResult
}

/**
 * Deletes a credential on a classic-tier (Standard/Premium) Postgres database.
 *
 * Throws if the resolved database is Essential-tier, or if any app still has
 * this credential attached.
 */
export async function deleteCredential(
  ctx: Pick<ResourceCtx, 'data' | 'platform'>,
  appIdentity: string,
  credName: string,
  options: PostgresDatabaseCredentialOptions = {},
): Promise<DeleteCredentialResult> {
  const {addonIdentity, signal} = options
  signal?.throwIfAborted()

  if (credName === 'default') {
    throw new Error('Default credential cannot be destroyed.')
  }

  const addon = await resolvePgDatabase(ctx, appIdentity, {input: addonIdentity, signal})

  if (isEssentialTier(addon)) {
    throw new Error("You can't destroy the default credential on Essential-tier databases.")
  }

  const platform = withSignal(ctx.platform, signal)
  const attachments = await platform.addOnAttachment.listByAddOn(addon.id)

  const credentialAttachments = attachments.filter(a => a.namespace === `credential:${credName}`)
  const attachedAppNames = [...new Set(credentialAttachments.map(a => a.app.name))]
  if (attachedAppNames.length > 0) {
    throw new Error(`Credential ${credName} must be detached from the app${attachedAppNames.length > 1 ? 's' : ''} ${attachedAppNames.join(', ')} before destroying.`)
  }

  const data = withSignal(ctx.data, signal)
  const result = await data.postgresDatabase.deleteCredential(addon.id, credName)
  return {addon, result}
}

export type GetUrlResult = {
  addon: ResolvedPgDatabase
  credentialConnectionInfo: CredentialConnectionInfo
}

/**
 * Fetches a classic-tier (Essential/Standard/Premium) Postgres credential's
 * active connection info and builds a ready-to-use connection URL.
 *
 * Throws if the resolved database is a legacy Essential-tier database and
 * `credName` isn't `'default'` (legacy Essential-tier databases don't
 * support named credentials), or if the credential has no active
 * connection info.
 */
export async function getUrl(
  ctx: Pick<ResourceCtx, 'data' | 'platform'>,
  appIdentity: string,
  credName: string,
  options: PostgresDatabaseCredentialOptions = {},
): Promise<GetUrlResult> {
  const {addonIdentity, signal} = options
  signal?.throwIfAborted()
  const addon = await resolvePgDatabase(ctx, appIdentity, {input: addonIdentity, signal})

  if (isLegacyEssentialDatabase(addon) && credName !== 'default') {
    throw new Error('Legacy Essential-tier databases do not support named credentials.')
  }

  const data = withSignal(ctx.data, signal)
  const info = await data.postgresDatabase.infoCredential(addon.id, credName)

  const activeCred = info.credentials.find(c => c.state === 'active')
  if (!activeCred) {
    throw new Error(`Could not find any active credentials for ${credName}.`)
  }

  const url = new URL(`postgres://${info.host}/${info.database}`)
  url.port = info.port.toString()
  if (activeCred.user && activeCred.password) {
    url.username = activeCred.user
    url.password = activeCred.password
  }

  const credentialConnectionInfo: CredentialConnectionInfo = {
    credName,
    database: info.database,
    host: info.host,
    password: activeCred.password,
    port: info.port,
    url: url.toString(),
    user: activeCred.user,
  }

  return {addon, credentialConnectionInfo}
}

export type RotateCredentialOpts = {
  /** Rotates every credential instead of a single named one. Mutually exclusive with `credName`. */
  all?: boolean
  /** Which credential to rotate. Defaults to `'default'`. Mutually exclusive with `all`. */
  credName?: string
  forced?: boolean
}

export type RotateCredentialOptions = PostgresDatabaseCredentialOptions & {
  /**
   * Runs after the database is resolved but before the rotate request
   * fires, with the resolved add-on.
   */
  beforeRotate?: (preview: {addon: ResolvedPgDatabase}) => Promise<void> | void
}

export type RotateAllCredentialsResult = {
  addon: ResolvedPgDatabase
  result: PostgresDatabaseRotateCredentialsResult
}

export type RotateCredentialResult = {
  addon: ResolvedPgDatabase
  result: PostgresDatabaseRotateCredentialResult
}

/**
 * Rotates one or all credentials on a classic-tier (Essential/Standard/Premium)
 * Postgres database.
 *
 * Throws if both `all` and `credName` are set — they're mutually exclusive.
 * Throws if the resolved database is a legacy Essential-tier database and
 * `credName` isn't `'default'`.
 */
export async function rotateCredential(
  ctx: Pick<ResourceCtx, 'data' | 'platform'>,
  appIdentity: string,
  body: RotateCredentialOpts & {all: true},
  options?: RotateCredentialOptions,
): Promise<RotateAllCredentialsResult>
export async function rotateCredential(
  ctx: Pick<ResourceCtx, 'data' | 'platform'>,
  appIdentity: string,
  body?: RotateCredentialOpts,
  options?: RotateCredentialOptions,
): Promise<RotateCredentialResult>
export async function rotateCredential(
  ctx: Pick<ResourceCtx, 'data' | 'platform'>,
  appIdentity: string,
  body: RotateCredentialOpts = {},
  options: RotateCredentialOptions = {},
): Promise<RotateAllCredentialsResult | RotateCredentialResult> {
  const {addonIdentity, beforeRotate, signal} = options
  signal?.throwIfAborted()

  if (body.all && body.credName !== undefined) {
    throw new Error('You cannot pass both `all` and `credName`')
  }

  const {all, credName = 'default', forced} = body

  const addon = await resolvePgDatabase(ctx, appIdentity, {input: addonIdentity, signal})

  if (isLegacyEssentialDatabase(addon) && credName !== 'default') {
    throw new Error('Legacy Essential-tier databases do not support named credentials.')
  }

  if (beforeRotate) {
    await beforeRotate({addon})
    signal?.throwIfAborted()
  }

  const data = withSignal(ctx.data, signal)

  if (all) {
    const result = await data.postgresDatabase.rotateCredentials(addon.id, {forced})
    return {addon, result}
  }

  const result = await data.postgresDatabase.rotateCredential(addon.id, credName, {forced})
  return {addon, result}
}
