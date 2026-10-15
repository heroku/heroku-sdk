import type {ConfigVar} from '@heroku/types/3.sdk'

import {NotFoundError} from '@heroku/heroku-fetch'
import createDebug from 'debug'

import type {ResourceCtx} from '../../../core/extend-resource.js'
import type {AddOnAttachmentWithInclusions, ResolveAddonAttachmentOptions, ResolvedAddOnAttachment} from '../../platform/add-on-attachment/resolve.js'

import {AddonAttachmentAmbiguousError, AddonAttachmentNotFoundError, resolveAddonAttachment} from '../../platform/add-on-attachment/resolve.js'
import {getAddonService} from './postgres-utils.js'

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
 * Thrown by `resolvePgDatabase` when the identity doesn't resolve to a
 * Postgres database on the app (no match, a match that isn't the configured
 * Postgres service, or no Postgres databases at all).
 */
export class PgDatabaseNotFoundError extends Error {
  constructor(message: string, options?: {cause?: unknown}) {
    super(message, options)
    this.name = 'PgDatabaseNotFoundError'
  }
}

/**
 * Resolve a Heroku Postgres database add-on from an attachment identity.
 *
 * `input` selects the attachment as follows:
 *   - omitted → the `DATABASE_URL` attachment on `appIdentity`.
 *   - `parent-app::attachment-or-config-var` (e.g. `my-app::DATABASE_URL`)
 *     → an attachment or config var on `parent-app`.
 *   - `parent-app::branch-name` (e.g. `my-app::my-branch`) → branch add-on
 *     name on `parent-app`.
 *   - Both `::` forms are handled the same way here: we split on the first
 *     `::` ourselves and send `app`/`addon` as separate fields, which
 *     works for either shape.
 *   - any other string (attachment name, config var, UUID, or
 *     globally-unique add-on name) → routed through `resolveAddonAttachment`,
 *     scoped to `appIdentity`.
 *
 * This function only uses the attachment resolver. To resolve a database
 * through the add-on resolve endpoint, call `resolveAddon` directly.
 *
 * The returned add-on is the identity nested on the attachment (`id`,
 * `name`, `app`, and the plan stub), not a full `ResolvedAddOn`. To get
 * that shape, call `resolveAddon` with the returned add-on's `id`.
 *
 * If the resolver finds multiple matches that all point at the same add-on
 * (same `addon.id`/attachment `app.id`) and whose own `_URL` config var
 * resolves to the same value on the app, they're treated as equivalent
 * (e.g. the same database attached under two names) rather than ambiguous.
 *
 * Throws a `PgDatabaseNotFoundError` when the resolve endpoint 404s, the matched
 * attachment is not the configured Postgres service, or the app has no databases.
 * Throws an `AddonAttachmentAmbiguousError` when the remaining matches are not
 * the same database. Throws a plain `Error` if `appIdentity` is empty and `input`
 * has no `::`-prefixed app to fall back on.
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
  const {includeAttachment, input, ...rest} = options

  const databaseReference = input ?? DEFAULT_PG_ATTACHMENT
  const {addon, app} = databaseReference.includes('::')
    ? parseBranchReference(databaseReference, appIdentity)
    : {addon: databaseReference, app: appIdentity}

  if (!app) {
    throw new Error('resolvePgDatabase requires a non-empty app identity.')
  }

  debug('resolve input=%s addon=%s app=%s', input ?? '<default>', addon, app)

  let attachment: ResolvedAddOnAttachment
  try {
    attachment = await resolveAddonAttachment(ctx, app, addon, {...rest, addonService: getAddonService()})
  } catch (error) {
    if (error instanceof NotFoundError || error instanceof AddonAttachmentNotFoundError) {
      throw await buildDatabaseNotFoundError(ctx, app, addon, error, rest.signal)
    }

    if (error instanceof AddonAttachmentAmbiguousError) {
      const equivalent = collapseIfEquivalent(error.matches)
      if (!equivalent) throw error

      let config: ConfigVar
      try {
        config = await ctx.platform
          .withOptions({signal: rest.signal})
          .configVar.infoForApp(equivalent[0].app.name)
      } catch (configVarError) {
        debug('config var lookup failed while collapsing ambiguous matches: %O', configVarError)
        throw error
      }

      if (!allMatchSameUrl(equivalent, config)) throw error

      attachment = equivalent[0]
    } else {
      throw error
    }
  }

  return includeAttachment ? {addon: attachment.addon, attachment} : attachment.addon
}

async function buildDatabaseNotFoundError(
  ctx: Pick<ResourceCtx, 'platform'>,
  appIdentity: string,
  attachmentId: string,
  error: AddonAttachmentNotFoundError | NotFoundError,
  signal?: AbortSignal,
): Promise<PgDatabaseNotFoundError> {
  let attachments: AddOnAttachmentWithInclusions[]
  try {
    attachments = await listPostgresAttachments(ctx, appIdentity, signal)
  } catch (listError) {
    debug('listing attachments failed while building not-found error: %O', listError)
    throw new PgDatabaseNotFoundError(`Could not resolve ${stripUrlSuffix(attachmentId)} on ${appIdentity}`, {cause: error})
  }

  if (attachments.length === 0) {
    return new PgDatabaseNotFoundError(`${appIdentity} has no ${getAddonService()} databases`, {cause: error})
  }

  const validOptions = attachments
    .map(attachment => {
      const urlVarName = urlConfigVarName(attachment.config_vars)
      return urlVarName ? stripUrlSuffix(urlVarName) : attachment.name
    })
    .join(', ')

  const databaseName = stripUrlSuffix(attachmentId)

  if (error instanceof AddonAttachmentNotFoundError) {
    return new PgDatabaseNotFoundError(`${databaseName} is not a ${getAddonService()} database on ${appIdentity}. Valid options are: ${validOptions}`, {cause: error})
  }

  return new PgDatabaseNotFoundError(`Unknown database: ${databaseName} on ${appIdentity}. Valid options are: ${validOptions}`, {cause: error})
}

async function listPostgresAttachments(
  ctx: Pick<ResourceCtx, 'platform'>,
  appIdentity: string,
  signal?: AbortSignal,
): Promise<AddOnAttachmentWithInclusions[]> {
  const attachments = await ctx.platform
    .withHeaders({'Accept-Inclusion': 'addon:plan,config_vars'})
    .withOptions({signal})
    .addOnAttachment.listByApp(appIdentity) as AddOnAttachmentWithInclusions[]

  return attachments.filter(attachment => attachment.addon?.plan?.name?.split(':', 2)[0] === getAddonService())
}

function stripUrlSuffix(name: string): string {
  return name.endsWith('_URL') ? name.slice(0, -4) : name
}

/**
 * Narrows ambiguous matches to a same-add-on group worth comparing by
 * config var value. Returns `undefined` (not worth a config-vars round
 * trip) unless every match shares the same add-on and attachment app.
 */
function collapseIfEquivalent(matches: AddOnAttachmentWithInclusions[]): AddOnAttachmentWithInclusions[] | undefined {
  const [first] = matches
  const sameAddon = matches.every(match => match.addon.id === first.addon.id && match.app.id === first.app.id)
  return sameAddon ? matches : undefined
}

/** The first config var name declared on an attachment that holds its connection URL. */
function urlConfigVarName(configVars: AddOnAttachmentWithInclusions['config_vars']): string | undefined {
  return configVars.find(name => name.endsWith('_URL'))
}

/** Whether every match's own URL config var resolves to the same value in `config`. */
function allMatchSameUrl(matches: AddOnAttachmentWithInclusions[], config: ConfigVar): boolean {
  const firstVarName = urlConfigVarName(matches[0].config_vars)
  const firstValue = firstVarName && config[firstVarName]
  if (!firstValue) {
    return false
  }

  return matches.every(match => {
    const varName = urlConfigVarName(match.config_vars)
    return varName !== undefined && config[varName] === firstValue
  })
}

function parseBranchReference(
  reference: string,
  fallbackApp: string,
): {addon: string; app: string} {
  const match = reference.match(/^(.+?)::(.+)$/)
  if (match) {
    return {addon: match[2], app: match[1]}
  }

  return {addon: reference, app: fallbackApp}
}
