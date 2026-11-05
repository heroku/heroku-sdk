import type {AddOnAttachment, AddOnAttachmentCreateOpts} from '@heroku/types/3.sdk'
import type {PostgresCredentialListResult} from '@heroku/types/data'

import {HerokuApiError, NotFoundError} from '@heroku/heroku-fetch'

import type {ResourceCtx} from '../../core/extend-resource.js'
import type {DeprovisioningAddOn, ResolvedAddOn} from '../platform/add-on/types.js'

import {extendResource} from '../../core/extend-resource.js'
import {withSignal} from '../../core/with-signal.js'
import {destroyAndWait} from '../platform/add-on/destroy-and-wait.js'
import {
  AddonAppMismatchError, AddonConfirmationRequiredError, AddonDestroyFailedError,
} from '../platform/add-on/errors.js'
import {resolveAddonInternal} from '../platform/add-on/resolve.js'
import {getPostgresServiceName, isAdvancedDatabase, NotAdvancedDatabaseError} from './internal/postgres-utils.js'
import {resolvePgDatabase} from './internal/resolve-pg-database.js'

export type ListCredentialsOptions = {
  signal?: AbortSignal
}

export type DeleteAttachmentOptions = {
  beforeDelete?: (preview: {addon: ResolvedAddOn; attachment: AddOnAttachment}) => Promise<void> | void
  onDetached?: (attachment: AddOnAttachment) => Promise<void> | void
  signal?: AbortSignal
}

export type DeleteAttachmentResult = {
  addon: ResolvedAddOn
  attachment: AddOnAttachment
  releaseVersion?: number
}

export type PostgresCredential = PostgresCredentialListResult['items'][number]

export type ListAttachmentsOptions = {
  appIdentity?: string
  signal?: AbortSignal
}

export type ListAttachmentsResult = {
  addon: ResolvedAddOn
  attachments: AddOnAttachment[]
  credentials: PostgresCredential[]
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
  onDeprovisioning?: (addon: DeprovisioningAddOn) => Promise<void> | void
  signal?: AbortSignal
  wait?: boolean
  waitIntervalMs?: number
}

export type DestroyResult = {
  addon: ResolvedAddOn
  // The delete response may carry the transient `deprovisioning` state when the
  // database deprovisions asynchronously (and `wait` is not set), so callers can
  // branch on it without casting.
  result: DeprovisioningAddOn
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
 * the delete request fires (an abort during the hook prevents the delete), and
 * `onDetached` runs once the attachment is deleted but before the release
 * version fetch. The returned `releaseVersion` is the latest release created by
 * unsetting the attachment's config vars.
 */
export async function deleteAttachment(
  ctx: Pick<ResourceCtx, 'platform'>,
  appIdentity: string,
  attachmentName: string,
  options: DeleteAttachmentOptions = {},
): Promise<DeleteAttachmentResult> {
  const {beforeDelete, onDetached, signal} = options
  signal?.throwIfAborted()

  // Bind the signal so the lookup, delete, and release-list requests abort in flight.
  const platform = withSignal(ctx.platform, signal)
  const attachment = await platform.addOnAttachment.infoByApp(appIdentity, attachmentName)
  const addon = await resolveAddonInternal(platform, attachment.addon.name, {addonService: getPostgresServiceName()})

  if (!isAdvancedDatabase(addon)) {
    throw new NotAdvancedDatabaseError(addon, `You can only detach Advanced-tier databases with postgresDatabase.deleteAttachment(). ${addon.name} isn't an Advanced-tier database.`)
  }

  await beforeDelete?.({addon, attachment})
  signal?.throwIfAborted()

  const deletedAttachment = await platform.addOnAttachment.delete(attachment.id)

  await onDetached?.(deletedAttachment)
  signal?.throwIfAborted()

  // The detach already succeeded; a failed release lookup shouldn't fail the
  // whole operation. Preserve aborts, otherwise report an unknown version.
  let releaseVersion: number | undefined
  try {
    const releases = await platform
      .withHeaders({Range: 'version ..; max=1, order=desc'})
      .release.list(appIdentity)
    releaseVersion = releases[0]?.version
  } catch (error) {
    // Preserve aborts; otherwise leave releaseVersion undefined (best-effort).
    if (signal?.aborted) {
      throw error
    }
  }

  return {addon, attachment: deletedAttachment, releaseVersion}
}

/**
 * Resolves a Postgres database by add-on identity and lists its attachments
 * alongside its credentials, fanning the two requests out in parallel.
 *
 * Resolution is scoped by `appIdentity` when given. Throws
 * `NotAdvancedDatabaseError` (carrying the resolved add-on) if the database
 * isn't an Advanced-tier database.
 */
export async function listAttachments(
  ctx: Pick<ResourceCtx, 'data' | 'platform'>,
  addonIdentity: string,
  options: ListAttachmentsOptions = {},
): Promise<ListAttachmentsResult> {
  const {appIdentity, signal} = options
  signal?.throwIfAborted()

  // Bind the signal so the resolve and fan-out requests abort in flight.
  const platform = withSignal(ctx.platform, signal)
  const data = withSignal(ctx.data, signal)
  const addon = await resolveAddonInternal(platform, addonIdentity, {addonService: getPostgresServiceName(), appIdentity})

  if (!isAdvancedDatabase(addon)) {
    throw new NotAdvancedDatabaseError(addon, `You can only list attachments on Advanced-tier databases with postgresDatabase.listAttachments(). ${addon.name} isn't an Advanced-tier database.`)
  }

  const [{items: credentials}, attachments] = await Promise.all([
    data.postgresCredential.list(addon.id),
    platform.addOnAttachment.listByAddOn(addon.id),
  ])

  return {addon, attachments, credentials}
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

  let addon: ResolvedAddOn
  try {
    addon = await resolveAddonInternal(platform, addonIdentity, {
      addonService: getPostgresServiceName(), appIdentity,
    })
  } catch (error) {
    // When scoped resolution misses, check whether the database exists under a
    // different app so we can surface a targeted mismatch error instead of a
    // bare not-found. Skip the probe for `::`-qualified identities: those name
    // their app inline, so `resolveAddonInternal` ignores `appIdentity` and the
    // unscoped retry would just repeat the same failing request.
    if (appIdentity && !addonIdentity.includes('::') && error instanceof NotFoundError) {
      let elsewhere: ResolvedAddOn | undefined
      try {
        elsewhere = await resolveAddonInternal(platform, addonIdentity, {
          addonService: getPostgresServiceName(),
        })
      } catch (retryError) {
        // Preserve aborts; an ambiguous/other failure here can't produce a
        // clean mismatch message, so fall through to the original not-found.
        if (signal?.aborted) {
          throw retryError
        }
      }

      // `appIdentity` may be an app name or UUID; compare against both so a
      // UUID-scoped caller isn't always flagged as a mismatch (and doesn't get
      // a raw UUID echoed back in the error message).
      if (elsewhere && elsewhere.app.id !== appIdentity && elsewhere.app.name !== appIdentity) {
        throw new AddonAppMismatchError(elsewhere, appIdentity)
      }
    }

    throw error
  }

  await beforeDestroy?.({addon})
  signal?.throwIfAborted()

  // Resolution and beforeDestroy aborts already happened above; a failure here
  // is the delete request (or wait poll) itself. Preserve aborts, but wrap other
  // failures so callers get the resolved add-on (and thus tier) without
  // re-resolving.
  try {
    const result = await destroyAndWait(ctx, addon.app.id, addon.id, {
      force, onDeprovisioning, signal, wait, waitIntervalMs,
    })
    return {addon, result}
  } catch (error) {
    if (signal?.aborted) {
      throw error
    }

    // A platform `confirmation_required` (e.g. destroying a database attached
    // to other apps without `force`) is a distinct, recoverable condition —
    // surface it as the typed error so callers can prompt and retry, matching
    // `createAttachment`, rather than collapsing it into a generic failure.
    if (error instanceof HerokuApiError && error.id === 'confirmation_required') {
      throw new AddonConfirmationRequiredError(error.message)
    }

    throw new AddonDestroyFailedError(addon, error)
  }
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
  listAttachments: (
    addonIdentity: string,
    options?: ListAttachmentsOptions,
  ) => listAttachments(ctx, addonIdentity, options),
  listCredentials: (
    appIdentity: string,
    addonIdentity?: string,
    options?: ListCredentialsOptions,
  ) => listCredentials(ctx, appIdentity, addonIdentity, options),
}))

export {
  AddonAppMismatchError, AddonConfirmationRequiredError, AddonDestroyFailedError, AddonNotFoundError,
} from '../platform/add-on/errors.js'

export type {DeprovisioningAddOn, ResolvedAddOn} from '../platform/add-on/types.js'

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
