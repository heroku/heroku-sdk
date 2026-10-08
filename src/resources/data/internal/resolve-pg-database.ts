import type {ConfigVar} from '@heroku/types/3.sdk'

import createDebug from 'debug'

import type {ResourceCtx} from '../../../core/extend-resource.js'
import type {AddOnAttachmentWithInclusions, ResolveAddonAttachmentOptions, ResolvedAddOnAttachment} from '../../platform/add-on-attachment/resolve.js'

import {AddonAttachmentAmbiguousError, resolveAddonAttachment} from '../../platform/add-on-attachment/resolve.js'
import {getAddonService} from './postgres-utils.js'

const debug = createDebug('heroku:sdk:resources:database')

const DEFAULT_PG_ATTACHMENT = 'DATABASE_URL'
const PG_ADDON_SERVICE = getAddonService()

export type ResolvedPgDatabase = ResolvedAddOnAttachment['addon']

export type ResolvedPgDatabaseWithAttachment = {
  addon: ResolvedPgDatabase
  attachment: ResolvedAddOnAttachment
}

export type ResolvePgDatabaseOptions = ResolveAddonAttachmentOptions & {
  appIdentity?: string,
  includeAttachment?: boolean
  input?: string
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
 *     globally-unique add-on name) → routed through `resolveAddonAttachment`.
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
 * Throws `AddonAttachmentNotFoundError` (or `AddonAttachmentAmbiguousError`)
 * from the underlying resolver. Throws if no input is given and no `appIdentity`
 * is available to default the attachment lookup to.
 */
export async function resolvePgDatabase(
  ctx: Pick<ResourceCtx, 'platform'>,
  options: ResolvePgDatabaseOptions & {includeAttachment: true},
): Promise<ResolvedPgDatabaseWithAttachment>
export async function resolvePgDatabase(
  ctx: Pick<ResourceCtx, 'platform'>,
  options?: ResolvePgDatabaseOptions,
): Promise<ResolvedPgDatabase>

export async function resolvePgDatabase(
  ctx: Pick<ResourceCtx, 'platform'>,
  options: ResolvePgDatabaseOptions = {},
): Promise<ResolvedPgDatabase | ResolvedPgDatabaseWithAttachment> {
  const {appIdentity, includeAttachment, input, ...rest} = options

  if (!input && !appIdentity) {
    throw new Error('resolvePgDatabase requires either input or appIdentity to default to DATABASE_URL.')
  }

  const databaseReference = input ?? DEFAULT_PG_ATTACHMENT
  const {addon, app} = databaseReference.includes('::')
    ? parseBranchReference(databaseReference, appIdentity)
    : {addon: databaseReference, app: appIdentity}

  debug('resolve input=%s addon=%s app=%s', input ?? '<default>', addon, app ?? '<global>')

  let attachment: ResolvedAddOnAttachment
  try {
    attachment = await resolveAddonAttachment(ctx, app, addon, {...rest, addonService: PG_ADDON_SERVICE})
  } catch (error) {
    if (!(error instanceof AddonAttachmentAmbiguousError)) throw error

    const equivalent = collapseIfEquivalent(error.matches)
    if (!equivalent) throw error

    const config = await ctx.platform.configVar.infoForApp(equivalent[0].app.name)
    if (!allMatchSameUrl(equivalent, config)) throw error

    attachment = equivalent[0]
  }

  return includeAttachment ? {addon: attachment.addon, attachment} : attachment.addon
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
function urlConfigVarName(configVars: string[]): string | undefined {
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
  fallbackApp?: string,
): {addon: string; app?: string} {
  const match = reference.match(/^(.+?)::(.+)$/)
  if (match) {
    return {addon: match[2], app: match[1]}
  }

  return fallbackApp ? {addon: reference, app: fallbackApp} : {addon: reference}
}
