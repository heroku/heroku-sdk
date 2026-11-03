import type {AddOn, AddOnAttachment, AddOnAttachmentCreateOpts} from '@heroku/types/3.sdk'

import {HerokuApiError, NotFoundError} from '@heroku/heroku-fetch'

import type {ResourceCtx} from '../../core/extend-resource.js'
import type {ResolvedAddOn} from '../platform/add-on/types.js'

import {extendResource} from '../../core/extend-resource.js'
import {withSignal} from '../../core/with-signal.js'
import {destroyAndWait} from '../platform/add-on/destroy-and-wait.js'
import {AddonConfirmationRequiredError, AddonNotFoundError} from '../platform/add-on/errors.js'
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

export type CreateAttachmentBody = Omit<AddOnAttachmentCreateOpts, 'addon' | 'app'>

export type CreateAttachmentOptions = {
  onAttached?: (attachment: AddOnAttachment) => Promise<void> | void
  signal?: AbortSignal
}

export type CreateAttachmentResult = {
  addon: ResolvedAddOn
  attachment: AddOnAttachment
  releaseVersion?: number
}

export type DestroyOptions = {
  appIdentity?: string
  /**
   * Runs after the database is resolved but before the delete request fires.
   * An abort (or throw) during the hook prevents the delete — use it to
   * confirm destruction against the resolved add-on.
   */
  beforeDestroy?: (preview: {addon: ResolvedAddOn}) => Promise<void> | void
  force?: boolean
  onDeprovisioning?: (addon: AddOn) => Promise<void> | void
  signal?: AbortSignal
  wait?: boolean
  waitIntervalMs?: number
}

export type DestroyResult = {
  addon: ResolvedAddOn
  result: AddOn
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
 * attachment's database isn't an Advanced-tier database.
 *
 * If provided, `beforeDelete` runs after resolution/tier-checking but before
 * the delete request fires. An abort during the hook prevents the delete.
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

/**
 * Resolves a source Postgres database by add-on identity, attaches it
 * to an app, and fetches the latest release version.
 *
 * Throws `NotAdvancedDatabaseError` (carrying the resolved add-on) if the
 * database isn't an Advanced-tier database.
 *
 * If provided, `onAttached` fires once the attachment is created but before
 * the release version fetch.
 */
export async function createAttachment(
  ctx: Pick<ResourceCtx, 'platform'>,
  appIdentity: string,
  addonIdentity: string,
  body: CreateAttachmentBody = {},
  options: CreateAttachmentOptions = {},
): Promise<CreateAttachmentResult> {
  const {onAttached, signal} = options
  signal?.throwIfAborted()

  // Bind the signal so the resolve, create, and release-list requests abort in flight.
  const platform = withSignal(ctx.platform, signal)

  // Resolve scoped to the target app first. If the target app has no match, retry
  // unscoped so attaching a database owned by a *different* app still resolves by
  // its globally-unique name.
  let addon: ResolvedAddOn
  try {
    addon = await resolveAddonInternal(platform, addonIdentity, {addonService: getPostgresServiceName(), appIdentity})
  } catch (error) {
    if (!(error instanceof NotFoundError)) {
      throw error
    }

    addon = await resolveAddonInternal(platform, addonIdentity, {addonService: getPostgresServiceName()})
  }

  if (!isAdvancedDatabase(addon)) {
    throw new NotAdvancedDatabaseError(addon, `You can only attach Advanced-tier databases with postgresDatabase.createAttachment(). ${addon.name} isn't an Advanced-tier database.`)
  }

  let attachment: AddOnAttachment
  try {
    attachment = await platform.addOnAttachment.create({
      ...body,
      addon: addon.name,
      app: appIdentity,
    })
  } catch (error) {
    if (error instanceof HerokuApiError && error.id === 'confirmation_required') {
      throw new AddonConfirmationRequiredError(error.message)
    }

    throw error
  }

  await onAttached?.(attachment)
  signal?.throwIfAborted()

  const releases = await platform
    .withHeaders({Range: 'version ..; max=1, order=desc'})
    .release.list(appIdentity)

  return {addon, attachment, releaseVersion: releases[0]?.version}
}

/**
 * Resolves a Postgres database by add-on identity and destroys it.
 *
 * Resolution is scoped by `appIdentity` when given. If provided,
 * `beforeDestroy` runs after resolution but before the delete request fires,
 * so callers can confirm against the resolved add-on; an abort or throw in
 * the hook prevents the delete. Delegates the delete (and optional
 * deprovisioning poll when `wait` is set) to `addOn.destroyAndWait`.
 */
export async function destroy(
  ctx: Pick<ResourceCtx, 'platform'>,
  addonIdentity: string,
  options: DestroyOptions = {},
): Promise<DestroyResult> {
  const {
    appIdentity, beforeDestroy, force, onDeprovisioning, signal, wait, waitIntervalMs,
  } = options
  signal?.throwIfAborted()

  // Bind the signal so the resolve request aborts in flight.
  const platform = withSignal(ctx.platform, signal)
  const addon = await resolveAddonInternal(platform, addonIdentity, {
    addonService: getPostgresServiceName(), appIdentity,
  })

  await beforeDestroy?.({addon})
  signal?.throwIfAborted()

  const result = await destroyAndWait(ctx, addon.app.id, addon.id, {
    force, onDeprovisioning, signal, wait, waitIntervalMs,
  })

  return {addon, result}
}

export const postgresDatabaseExtensions = extendResource('data', 'postgresDatabase', ctx => ({
  createAttachment: (
    appIdentity: string,
    addonIdentity: string,
    body?: CreateAttachmentBody,
    options?: CreateAttachmentOptions,
  ) => createAttachment(ctx, appIdentity, addonIdentity, body, options),
  deleteAttachment: (
    appIdentity: string,
    attachmentName: string,
    options?: DeleteAttachmentOptions,
  ) => deleteAttachment(ctx, appIdentity, attachmentName, options),
  destroy: (
    addonIdentity: string,
    options?: DestroyOptions,
  ) => destroy(ctx, addonIdentity, options),
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
