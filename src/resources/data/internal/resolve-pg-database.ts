import type {ConfigVar} from '@heroku/types/3.sdk'

import {NotFoundError} from '@heroku/heroku-fetch'
import createDebug from 'debug'

import type {ResourceCtx} from '../../../core/extend-resource.js'
import type {AddOnAttachmentWithInclusions, ResolveAddonAttachmentOptions, ResolvedAddOnAttachment} from '../../platform/add-on-attachment/resolve.js'

import {withSignal} from '../../../core/with-signal.js'
import {AddonAttachmentAmbiguousError, AddonAttachmentNotFoundError, resolveAddonAttachment} from '../../platform/add-on-attachment/resolve.js'
import {getPostgresServiceName, isPostgresAddon} from './postgres-utils.js'

const debug = createDebug('heroku:sdk:resources:database')

const DEFAULT_PG_ATTACHMENT = 'DATABASE_URL'

export type ResolvedPgDatabase = ResolvedAddOnAttachment['addon']

export type ResolvedPgDatabaseWithAttachment = {
  addon: ResolvedPgDatabase
  attachment: ResolvedAddOnAttachment
}

export type ResolvePgDatabaseOptions = ResolveAddonAttachmentOptions & {
  includeAttachment?: boolean
  input?: string
}

/**
 * Thrown by `resolvePgDatabase` when a database cannot be resolved: the app
 * has no Postgres databases, the attachment is not found, or the matched
 * attachment is not the configured Postgres service.
 */
export class PgDatabaseNotFoundError extends Error {
  override readonly name = 'PgDatabaseNotFoundError'
}

/**
 * Resolve a Heroku Postgres database add-on from an attachment identity.
 *
 * `input` selects the attachment as follows:
 *   - omitted or `''` → the `DATABASE_URL` attachment on `appIdentity`.
 *   - `parent-app::attachment-or-config-var` (e.g. `my-app::DATABASE_URL`)
 *     → an attachment or config var on `parent-app`.
 *   - `parent-app::branch-name` (e.g. `my-app::my-branch`) → branch add-on
 *     name on `parent-app`.
 *   - any other string (attachment name, config var, UUID, or
 *     globally-unique add-on name) → routed through `resolveAddonAttachment`,
 *     scoped to `appIdentity`.
 *
 * This function intentionally relies on the attachment resolve endpoint. To
 * resolve a database through the add-on resolve endpoint, call `resolveAddon`
 * directly.
 *
 * The returned add-on is the identity nested on the attachment (`id`,
 * `name`, `app`, and the plan stub), not a full `ResolvedAddOn`. To get
 * that shape, call `resolveAddon` with the returned add-on's `id`.
 *
 * A single resolver match is returned directly.
 *
 * If the resolver finds multiple matches that all point to the same add-on
 * (same `addon.id`/attachment `app.id`) and whose own `_URL` config var
 * resolves to the same value on the app, they're treated as equivalent
 * (e.g. the same database attached under two names) rather than ambiguous.
 *
 * If the resolver finds no match at all, falls back to treating `input` as
 * a literal config var name (adding a `_URL` suffix if missing) and looking
 * for a Postgres attachment on the app whose own `_URL` config var resolves
 * to the same value. This covers an app config var that is not one of the
 * attachment's own config vars, but whose value is the same database URL.
 *
 * Throws a `PgDatabaseNotFoundError` when the resolve endpoint 404s, the matched
 * attachment is not the configured Postgres service, or the app has no databases.
 * Throws an `AddonAttachmentAmbiguousError` when the remaining matches are not
 * the same database. Throws a plain `Error` if `appIdentity` is empty and `input`
 * has no `::`-prefixed app to fall back on.
 *
 * `resolvePgDatabase` should not throw a bare `NotFoundError`. Extensions that
 * use it typically couple it with a second data call (e.g. `data.database.info(addon.id)`)
 * that can also 404. Callers often catch `NotFoundError` to handle that second
 * call's failure specifically. However, if a resolution failure surfaced as a
 * `NotFoundError` too, that catch would swallow it and mislabel it as the second
 * call's failure instead. Resolution failures are reported as `PgDatabaseNotFoundError`
 * so the two stay separable by type.
 */
export async function resolvePgDatabase(
  ctx: Pick<ResourceCtx, 'platform'>,
  appIdentity: string,
  options: ResolvePgDatabaseOptions & {includeAttachment: true},
): Promise<ResolvedPgDatabaseWithAttachment>
export async function resolvePgDatabase(
  ctx: Pick<ResourceCtx, 'platform'>,
  appIdentity: string,
  options?: ResolvePgDatabaseOptions,
): Promise<ResolvedPgDatabase>

export async function resolvePgDatabase(
  ctx: Pick<ResourceCtx, 'platform'>,
  appIdentity: string,
  options: ResolvePgDatabaseOptions = {},
): Promise<ResolvedPgDatabase | ResolvedPgDatabaseWithAttachment> {
  const {includeAttachment, input, signal, ...rest} = options

  const databaseReference = input || DEFAULT_PG_ATTACHMENT
  const {app: parentApp, attachmentId} = parseDatabaseReference(databaseReference, appIdentity)

  if (!parentApp) {
    throw new Error('resolvePgDatabase requires a non-empty app identity.')
  }

  debug('resolve input=%s attachment=%s app=%s', input ?? '<default>', attachmentId, parentApp)

  let attachment: ResolvedAddOnAttachment | undefined
  try {
    attachment = await resolveAddonAttachment(ctx, parentApp, attachmentId, {...rest, addonService: getPostgresServiceName(), signal})
  } catch (error) {
    attachment = await attachmentResolutionFallback(ctx, parentApp, attachmentId, error, signal)
  }

  return includeAttachment ? {addon: attachment.addon, attachment} : attachment.addon
}

/**
 * Fallback when `resolveAddonAttachment` throws. Returns an attachment when the failure
 * can be recovered from:
 *   - `NotFoundError` or `AddonAttachmentNotFoundError` → list the app's Postgres attachments.
 *     An empty list throws `PgDatabaseNotFoundError`. Otherwise treat `attachmentId` as a config
 *     var (adding `_URL` if missing) and keep every attachment whose own `_URL` value equals it.
 *     Those matches already share one `_URL` value by construction, so only a same-add-on check
 *     is needed before returning the first one. No matches, or matches that span more than one
 *     add-on, throws `PgDatabaseNotFoundError`.
 *   - `AddonAttachmentAmbiguousError` → collapse `error.matches` to one attachment via
 *     `equivalentAttachment` when they're the same database (same add-on, same attachment app,
 *     and the same non-empty `_URL` value fetched from the app's config vars). Otherwise rethrow.
 *   - any other error → rethrow.
 */
async function attachmentResolutionFallback(
  ctx: Pick<ResourceCtx, 'platform'>,
  appIdentity: string,
  attachmentId: string,
  error: unknown,
  signal?: AbortSignal,
): Promise<AddOnAttachmentWithInclusions> {
  if (isAttachmentNotFoundError(error)) {
    const attachments = await listPostgresAttachments(ctx, appIdentity, attachmentId, error, signal)
    if (attachments.length === 0) {
      throw new PgDatabaseNotFoundError(`${appIdentity} has no ${getPostgresServiceName()} databases`, {cause: error})
    }

    const resolutionError = buildDatabaseNotFoundError(appIdentity, attachmentId, attachments, error)
    const matches = await resolveAttachmentViaConfigVarName(ctx, appIdentity, attachmentId, attachments, resolutionError, signal)

    if (matches.length === 0 || !sameAddon(matches)) throw resolutionError

    return matches[0]
  }

  if (error instanceof AddonAttachmentAmbiguousError) {
    const equivalent = await equivalentAttachment(ctx, error.matches, error, signal)
    if (!equivalent) throw error

    return equivalent
  }

  throw error
}

/**
 * Used by `attachmentResolutionFallback` to collapse ambiguous matches to the first
 * attachment when all matches target the same database: same add-on, same attachment
 * app, and the same non-empty `_URL` value. Returns `undefined` when the matches are
 * not equivalent or the first match has no `_URL` value. `matches` must be non-empty.
 */
async function equivalentAttachment(
  ctx: Pick<ResourceCtx, 'platform'>,
  matches: AddOnAttachmentWithInclusions[],
  error: AddonAttachmentAmbiguousError,
  signal?: AbortSignal,
): Promise<AddOnAttachmentWithInclusions | undefined> {
  const [first] = matches
  if (!sameAddon(matches)) return undefined

  const appConfig = await listAppConfigVars(ctx, first.app.name, error, signal)
  const firstUrlValue = getUrlConfigVarValue(first, appConfig)
  if (!firstUrlValue) return undefined

  const sameDatabaseUrl = matches.every(match => getUrlConfigVarValue(match, appConfig) === firstUrlValue)

  return sameDatabaseUrl ? first : undefined
}

/**
 * Used by `attachmentResolutionFallback` to list an app's config vars. An aborted
 * signal throws the abort error. Any other listing failure throws `error` (the
 * resolution error for this attempt).
 */
async function listAppConfigVars(
  ctx: Pick<ResourceCtx, 'platform'>,
  appIdentity: string,
  error: AddonAttachmentAmbiguousError | PgDatabaseNotFoundError,
  signal?: AbortSignal,
): Promise<ConfigVar> {
  try {
    return await withSignal(ctx.platform, signal)
      .configVar.infoForApp(appIdentity)
  } catch (configVarError) {
    signal?.throwIfAborted()

    debug('config var lookup failed while attempting to resolve via fallback: %O', configVarError)
    throw error
  }
}

/**
 * Used by `attachmentResolutionFallback` to list all attachments on an app that match the
 * add-on service filter. Throws `PgDatabaseNotFoundError` if the app does not exist
 * or the listing fails for any other reason.
 */
async function listPostgresAttachments(
  ctx: Pick<ResourceCtx, 'platform'>,
  appIdentity: string,
  attachmentId: string,
  error: AddonAttachmentNotFoundError | NotFoundError,
  signal?: AbortSignal,
): Promise<AddOnAttachmentWithInclusions[]> {
  let attachments: AddOnAttachmentWithInclusions[]
  try {
    attachments = await withSignal(
      ctx.platform.withHeaders({'Accept-Inclusion': 'addon:plan,config_vars'}),
      signal,
    ).addOnAttachment.listByApp(appIdentity) as AddOnAttachmentWithInclusions[]
  } catch (listError) {
    signal?.throwIfAborted()

    if (listError instanceof NotFoundError) {
      // Listing attachments 404s only when the app does not exist, which would
      // also be the reason for the attachment resolution failure. Therefore,
      // we surface this error specifically.
      throw new PgDatabaseNotFoundError(`Couldn't find that app: ${appIdentity}`, {cause: listError})
    }

    debug('listing attachments failed while building not-found error: %O', listError)
    throw new PgDatabaseNotFoundError(`Could not resolve ${stripUrlSuffix(attachmentId)} on ${appIdentity}`, {cause: error})
  }

  return attachments.filter(attachment => isPostgresAddon(attachment.addon))
}

/**
 * Used by `attachmentResolutionFallback` to resolve attachments via app config vars
 * when no matches were found. Treats `attachmentId` as a config var name and
 * uses its value to filter the attachments. Returns an empty array if the
 * config var value is not found.
 */
async function resolveAttachmentViaConfigVarName(
  ctx: Pick<ResourceCtx, 'platform'>,
  appIdentity: string,
  attachmentId: string,
  attachments: AddOnAttachmentWithInclusions[],
  error: PgDatabaseNotFoundError,
  signal?: AbortSignal,
): Promise<AddOnAttachmentWithInclusions[]> {
  const appConfig = await listAppConfigVars(ctx, appIdentity, error, signal)
  const inputConfigVarName = attachmentId.endsWith('_URL') ? attachmentId : `${attachmentId}_URL`
  const inputConfigVarValue = appConfig[inputConfigVarName]

  if (!inputConfigVarValue) return []

  return attachments.filter(attachment => getUrlConfigVarValue(attachment, appConfig) === inputConfigVarValue)
}

/**
 * Builds a `PgDatabaseNotFoundError` when attachment resolution endpoint 404s (NotFoundError)
 * or attachments did not match the add-on service filter (AddonAttachmentNotFoundError).
 */
function buildDatabaseNotFoundError(
  appIdentity: string,
  attachmentId: string,
  attachments: AddOnAttachmentWithInclusions[],
  error: AddonAttachmentNotFoundError | NotFoundError,
): PgDatabaseNotFoundError {
  const validOptions = attachments
    .map(attachment => {
      const urlVarName = getUrlConfigVarName(attachment.config_vars)
      return urlVarName ? stripUrlSuffix(urlVarName) : attachment.name
    })
    .join(', ')

  const databaseName = stripUrlSuffix(attachmentId)

  if (error instanceof AddonAttachmentNotFoundError) {
    return new PgDatabaseNotFoundError(`${databaseName} is not a ${getPostgresServiceName()} database on ${appIdentity}. Valid options are: ${validOptions}`, {cause: error})
  }

  return new PgDatabaseNotFoundError(`Unknown database: ${databaseName} on ${appIdentity}. Valid options are: ${validOptions}`, {cause: error})
}

/**
 * Returns the first config var name declared on an attachment that holds its connection
 * URL or `undefined` if no such config var is found.
 */
function getUrlConfigVarName(configVars: AddOnAttachmentWithInclusions['config_vars']): string | undefined {
  return configVars.find(name => name.endsWith('_URL'))
}

/**
 * Looks up the value of `attachment`'s own `_URL` config var in `appConfig`, or
 * `undefined` if the attachment has no `_URL`-suffixed config var.
 */
function getUrlConfigVarValue(attachment: AddOnAttachmentWithInclusions, appConfig: ConfigVar): string | undefined {
  const urlVarName = getUrlConfigVarName(attachment.config_vars)
  return urlVarName ? appConfig[urlVarName] : undefined
}

/**
 * Returns true if `error` is a NotFoundError (attachment resolution endpoint 404) or
 * AddonAttachmentNotFoundError (attachments did not match the add-on service filter).
 */
function isAttachmentNotFoundError(error: unknown): error is AddonAttachmentNotFoundError | NotFoundError {
  return error instanceof AddonAttachmentNotFoundError || error instanceof NotFoundError
}

/**
 * Splits an `app::database` reference into the app and the attachment id.
 * A reference with no `::` uses `appIdentity` as the app and the whole
 * reference as the attachment id.
 */
function parseDatabaseReference(
  reference: string,
  appIdentity: string,
): {app: string; attachmentId: string;} {
  const match = reference.match(/^(.+?)::(.+)$/)
  if (match) {
    return {app: match[1], attachmentId: match[2]}
  }

  return {app: appIdentity, attachmentId: reference}
}

/** Whether every match shares the same add-on and attachment app. */
function sameAddon(matches: AddOnAttachmentWithInclusions[]): boolean {
  const [first] = matches
  return matches.every(match => match.addon.id === first.addon.id && match.app.id === first.app.id)
}

/**
 * Removes the `_URL` suffix from a config var name if it exists.
 */
function stripUrlSuffix(name: string): string {
  return name.endsWith('_URL') ? name.slice(0, -4) : name
}
