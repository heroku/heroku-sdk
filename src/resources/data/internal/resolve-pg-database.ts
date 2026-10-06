import createDebug from 'debug'

import type {ResourceCtx} from '../../../core/extend-resource.js'
import type {ResolveAddonAttachmentOptions, ResolvedAddOnAttachment} from '../../platform/add-on-attachment/resolve.js'

import {resolveAddonAttachment} from '../../platform/add-on-attachment/resolve.js'

const debug = createDebug('heroku:sdk:resources:database')

const DEFAULT_PG_ATTACHMENT = 'DATABASE_URL'
const PG_ADDON_SERVICE = process.env.HEROKU_POSTGRESQL_ADDON_NAME ??  process.env.HEROKU_DATA_SERVICE ?? 'heroku-postgresql'

export type ResolvedPgDatabase = ResolvedAddOnAttachment['addon']

export type ResolvePgDatabaseOptions = ResolveAddonAttachmentOptions & {
  appIdentity?: string,
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
 * Throws `AddonAttachmentNotFoundError` (or `AddonAttachmentAmbiguousError`)
 * from the underlying resolver. Throws if no input is given and no `appIdentity`
 * is available to default the attachment lookup to.
 */
export async function resolvePgDatabase(
  ctx: Pick<ResourceCtx, 'platform'>,
  options: ResolvePgDatabaseOptions = {},
): Promise<ResolvedPgDatabase> {
  const {appIdentity, input, ...rest} = options

  if (!input && !appIdentity) {
    throw new Error('resolvePgDatabase requires either input or appIdentity to default to DATABASE_URL.')
  }

  const databaseReference = input ?? DEFAULT_PG_ATTACHMENT
  const {addon, app} = databaseReference.includes('::')
    ? parseBranchReference(databaseReference, appIdentity)
    : {addon: databaseReference, app: appIdentity}

  debug('resolve input=%s addon=%s app=%s', input ?? '<default>', addon, app ?? '<global>')
  const attachment = await resolveAddonAttachment(ctx, app, addon, {...rest, addonService: PG_ADDON_SERVICE})
  return attachment.addon
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
