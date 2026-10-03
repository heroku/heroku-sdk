import createDebug from 'debug'

import type {ResourceCtx} from '../../../core/extend-resource.js'
import type {ResolveAddonOptions, ResolvedAddOn} from '../../platform/add-on/index.js'

import {resolveAddon} from '../../platform/add-on/index.js'

const debug = createDebug('heroku:sdk:resources:database')

const DEFAULT_PG_ATTACHMENT = 'DATABASE_URL'
const PG_ADDON_SERVICE = process.env.HEROKU_POSTGRESQL_ADDON_NAME ??  process.env.HEROKU_DATA_SERVICE ?? 'heroku-postgresql'

export type ResolvePgDatabaseOptions = ResolveAddonOptions & {
  input?: string
}

/**
 * Resolve a Heroku Postgres database add-on from any of the input
 * shapes the platform recognizes:
 *
 *   - omitted → the `DATABASE_URL` attachment on `appIdentity`.
 *   - `parent-app::attachment-or-config-var` (e.g. `my-app::DATABASE_URL`)
 *     → an attachment or config var on `parent-app`.
 *   - `parent-app::branch-name` (e.g. `my-app::my-branch`) → branch add-on
 *     name on `parent-app`.
 *   - Both `::` forms are handled the same way here: we split on the first
 *     `::` ourselves and send `app`/`addon` as separate fields, which
 *     works for either shape.
 *   - any other string (attachment name, config var, UUID, or
 *     globally-unique add-on name) → routed through `resolveAddon`.
 *
 * Throws `AddonNotFoundError` (or `AddonAmbiguousError`) from the
 * underlying resolver. Throws if no input is given and no `appIdentity`
 * is available to default the attachment lookup to.
 */
export async function resolvePgDatabase(
  ctx: Pick<ResourceCtx, 'platform'>,
  options: ResolvePgDatabaseOptions = {},
): Promise<ResolvedAddOn> {
  const {appIdentity, input, ...rest} = options

  if (!input && !appIdentity) {
    throw new Error('resolvePgDatabase requires either input or appIdentity to default to DATABASE_URL.')
  }

  const databaseReference = input ?? DEFAULT_PG_ATTACHMENT
  const {addon, app} = databaseReference.includes('::')
    ? parseBranchReference(databaseReference, appIdentity)
    : {addon: databaseReference, app: appIdentity}

  debug('resolve input=%s addon=%s app=%s', input ?? '<default>', addon, app ?? '<global>')
  return resolveAddon(ctx, addon, {...rest, addonService: PG_ADDON_SERVICE, appIdentity: app})
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
