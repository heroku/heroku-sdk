import type {AddOnAttachment} from '@heroku/types/3.sdk'

import type {ResourceCtx} from '../../core/extend-resource.js'
import type {ResolvedAddOn} from '../platform/add-on/types.js'

import {extendResource} from '../../core/extend-resource.js'
import {withSignal} from '../../core/with-signal.js'
import {resolveAddonInternal} from '../platform/add-on/resolve.js'
import {getPostgresServiceName, isAdvancedDatabase, NotAdvancedDatabaseError} from './internal/postgres-utils.js'
import {resolvePgDatabase} from './internal/resolve-pg-database.js'

export type ListCredentialsOptions = {
  signal?: AbortSignal
}

export type DeleteAttachmentOptions = {
  beforeDelete?: (preview: {addon: ResolvedAddOn; attachment: AddOnAttachment}) => Promise<void> | void
  signal?: AbortSignal
}

export type DeleteAttachmentResult = {
  addon: ResolvedAddOn
  attachment: AddOnAttachment
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

export async function listCredentials(
  ctx: Pick<ResourceCtx, 'data' | 'platform'>,
  appIdentity: string,
  addonIdentity?: string,
  options: ListCredentialsOptions = {},
): Promise<CredentialInfo[]> {
  options.signal?.throwIfAborted()
  const addon = await resolvePgDatabase(ctx, appIdentity, {input: addonIdentity, ...options})
  // Bind the signal so the request aborts in flight, not just during resolution.
  const data = withSignal(ctx.data, options.signal)
  return data.postgresDatabase.listCredentials(addon.id) as unknown as Promise<CredentialInfo[]>
}

/**
 * Looks up a Postgres attachment by name under an app, resolves its add-on,
 * and deletes the attachment.
 *
 * Throws `NotAdvancedDatabaseError` (carrying the resolved add-on) if the
 * attachment's database isn't an Advanced-tier database. If provided,
 * `beforeDelete` runs after resolution/tier-checking but before the delete
 * request fires; an abort during the hook prevents the delete.
 */
export async function deleteAttachment(
  ctx: Pick<ResourceCtx, 'platform'>,
  appIdentity: string,
  attachmentName: string,
  options: DeleteAttachmentOptions = {},
): Promise<DeleteAttachmentResult> {
  const {beforeDelete, signal} = options
  signal?.throwIfAborted()

  // Bind the signal so the lookup and delete requests abort in flight.
  const platform = withSignal(ctx.platform, signal)
  const attachment = await platform.addOnAttachment.infoByApp(appIdentity, attachmentName)
  const addon = await resolveAddonInternal(platform, attachment.addon.name, {addonService: getPostgresServiceName()})

  if (!isAdvancedDatabase(addon)) {
    throw new NotAdvancedDatabaseError(addon, `You can only detach Advanced-tier databases with postgresDatabase.deleteAttachment(). ${addon.name} isn't an Advanced-tier database.`)
  }

  await beforeDelete?.({addon, attachment})
  signal?.throwIfAborted()

  const deletedAttachment = await platform.addOnAttachment.delete(attachment.id)

  return {addon, attachment: deletedAttachment}
}

export const postgresDatabaseExtensions = extendResource('data', 'postgresDatabase', ctx => ({
  deleteAttachment: (
    appIdentity: string,
    attachmentName: string,
    options?: DeleteAttachmentOptions,
  ) => deleteAttachment(ctx, appIdentity, attachmentName, options),
  listCredentials: (
    appIdentity: string,
    addonIdentity?: string,
    options?: ListCredentialsOptions,
  ) => listCredentials(ctx, appIdentity, addonIdentity, options),
}))

export {
  type AttachmentFactors, parseAttachmentFactors,
} from './internal/parse-attachment-factors.js'

export {
  findLegacyDatabase,
  getPostgresServiceName,
  isAdvancedCredential,
  isAdvancedDatabase,
  isEssentialDatabase,
  isEssentialTier,
  isLegacyDatabase,
  isLegacyEssentialDatabase,
  isPostgresAddon,
  NotAdvancedDatabaseError,
} from './internal/postgres-utils.js'
