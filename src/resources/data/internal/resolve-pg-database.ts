import type {ResourceCtx} from '../../../core/extend-resource.js'
import type {ResolveAddonOptions, ResolvedAddOn} from '../../platform/add-on.js'

import {resolveAddon, resolveAddonByAttachment} from '../../platform/add-on.js'

const DEFAULT_PG_ATTACHMENT = 'DATABASE_URL'

export type ResolvePgDatabaseOptions = ResolveAddonOptions & {
  input?: string
}

/**
 * Resolve a Heroku Postgres database add-on from any of the input
 * shapes the platform recognizes:
 *
 *   - omitted → the `DATABASE_URL` attachment on `appIdentity`.
 *   - `DATABASE_URL`, `HEROKU_POSTGRESQL_GREEN`, etc. → that attachment
 *     on `appIdentity`. Detected by SHOUTY_SNAKE_CASE shape.
 *   - `parent-app::branch-name` → branch reference. The portion before
 *     `::` is the parent app; the portion after is the branch add-on
 *     name.
 *   - any other string → a bare add-on identity (UUID, globally-unique
 *     name) routed through `resolveAddon`.
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

  if (!input) {
    if (!appIdentity) {
      throw new Error('resolvePgDatabase requires either input or appIdentity to default to DATABASE_URL.')
    }

    return resolveAddonByAttachment(ctx, appIdentity, DEFAULT_PG_ATTACHMENT, rest)
  }

  if (input.includes('::')) {
    const {addon, app} = parseBranchReference(input, appIdentity)
    return resolveAddon(ctx, addon, {...rest, appIdentity: app})
  }

  if (appIdentity && isAttachmentName(input)) {
    return resolveAddonByAttachment(ctx, appIdentity, input, rest)
  }

  return resolveAddon(ctx, input, {...rest, appIdentity})
}

function isAttachmentName(input: string): boolean {
  return /^[A-Z][A-Z0-9_]*$/.test(input)
}

function parseBranchReference(
  reference: string,
  fallbackApp?: string,
): {addon: string; app?: string} {
  const match = reference.match(/^(.+)::(.+)$/)
  if (match) {
    return {addon: match[2], app: match[1]}
  }

  return fallbackApp ? {addon: reference, app: fallbackApp} : {addon: reference}
}
