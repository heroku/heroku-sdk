import type {AddOnAttachment} from '@heroku/types/3.sdk'

import createDebug from 'debug'

import type {ResourceCtx} from '../../../core/extend-resource.js'

const debug = createDebug('heroku:sdk:resources:add-on-attachment')

export class AddonAttachmentNotFoundError extends Error {
  public readonly id = 'not_found'
  public readonly statusCode = 404

  constructor(public readonly resource: string = 'addon attachment') {
    super(`Couldn't find that ${resource}.`)
    this.name = 'AddonAttachmentNotFoundError'
  }

  public get body() {
    return {id: this.id, message: this.message, resource: this.resource}
  }
}

export class AddonAttachmentAmbiguousError extends Error {
  public readonly id = 'multiple_matches'
  public readonly statusCode = 422

  constructor(public readonly matches: AddOnAttachment[]) {
    super(`Ambiguous identifier; multiple matching add-on attachments found: ${matches.map(m => m.name).join(', ')}.`)
    this.name = 'AddonAttachmentAmbiguousError'
  }

  public get body() {
    return {id: this.id, message: this.message}
  }
}

/**
 * `Accept-Inclusion: addon:plan` requests the add-on's plan, but
 * @heroku/types doesn't model that inclusion. Extend locally rather than
 * casting through `any`.
 */
type AddOnAttachmentWithPlan = AddOnAttachment & {
  addon: AddOnAttachment['addon'] & {
    plan: {id?: string, name: string}
  }
}

/**
 * An attachment that has passed through `singularize`: its add-on `id`/
 * `app.id` are guaranteed non-null at runtime. At the currently installed
 * `@heroku/types` schema, `AddOnAttachment` already types these as
 * required, so this doesn't narrow anything today — it exists to give the
 * SDK a stable name decoupled from the generated type (insurance against
 * that schema loosening these back to optional) and to document, by name,
 * that a value carrying this type has actually been through resolution.
 */
export type ResolvedAddOnAttachment = AddOnAttachmentWithPlan & {
  addon: NonNullable<AddOnAttachmentWithPlan['addon']> & {app: {id: string}; id: string}
}

export type AddonAttachmentOptions = {
  /**
   * Restrict matches to attachments whose add-on plan belongs to this
   * add-on service (e.g. `heroku-postgresql`), filtered client-side.
   */
  addonService?: string
  signal?: AbortSignal
}

/**
 * Resolve a Platform add-on *attachment* by identity.
 *
 * The add-on attachment identity may be:
 *   - an attachment UUID (`d5e3f2a4-...`)
 *   - an attachment name (`DATABASE`)
 *   - a config var (`DATABASE_URL`)
 *   - an app-scoped attachment name or config var (`my-app::DATABASE`,
 *    `my-app::DATABASE_URL`)
 *   - a globally-unique add-on name (`postgres-curved-12345`)
 *
 * To resolve just the add-on the attachment points to, use `resolveAddon`.
 *
 * Always sends `Accept-Inclusion: addon:plan` on the resolve request so
 * matches come back with their add-on's plan, needed to filter by
 * `addonService`.
 */
export async function resolveAddonAttachment(
  ctx: Pick<ResourceCtx, 'platform'>,
  appIdentity: string | undefined,
  attachmentName: string,
  options: AddonAttachmentOptions = {},
): Promise<ResolvedAddOnAttachment> {
  const {addonService, signal} = options

  signal?.throwIfAborted()
  debug('resolve app=%s attachment=%s service=%s', appIdentity ?? '<global>', attachmentName, addonService ?? '<any>')

  const platform = ctx.platform
    .withHeaders({'Accept-Inclusion': 'addon:plan'})
    .withOptions({signal})

  const matches = await platform.addOnAttachment.resolution({
    // eslint-disable-next-line camelcase
    addon_attachment: attachmentName,
    app: appIdentity,
  }) as AddOnAttachmentWithPlan[]

  const filtered = addonService
    ? matches.filter(match => match.addon?.plan?.name?.split(':', 2)[0] === addonService)
    : matches

  debug('resolve matches=%d filtered=%d (service=%s)', matches.length, filtered.length, addonService ?? '<any>')
  const resolvedAttachment = singularize(filtered)
  debug('resolve resolved attachment=%s addon=%s app=%s', resolvedAttachment.id, resolvedAttachment.addon.id, resolvedAttachment.addon.app.id)
  return resolvedAttachment
}

function singularize(matches: AddOnAttachmentWithPlan[]): ResolvedAddOnAttachment {
  if (matches.length === 0) {
    throw new AddonAttachmentNotFoundError()
  }

  if (matches.length > 1) {
    throw new AddonAttachmentAmbiguousError(matches)
  }

  const match = matches[0]
  if (!match.addon?.id || !match.addon?.app?.id) {
    throw new Error(`Resolved attachment is missing required add-on fields (addon.id=${match.addon.id}, addon.app.id=${match.addon.app.id})`)
  }

  return match as ResolvedAddOnAttachment
}
