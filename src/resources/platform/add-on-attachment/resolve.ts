import type {AddOnAttachment} from '@heroku/types/3.sdk'

import {NotFoundError} from '@heroku/heroku-fetch'
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
type AddOnAttachmentWithDetails = AddOnAttachment & {
  addon: AddOnAttachment['addon'] & {plan?: {name?: string}}
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
export type ResolvedAddOnAttachment = AddOnAttachmentWithDetails & {
  addon: NonNullable<AddOnAttachmentWithDetails['addon']> & {app: {id: string}; id: string}
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
 * Resolve an add-on *attachment* via its name on a given app.
 *
 * The add-on attachment identity may be:
 *   - an attachment UUID (`d5e3f2a4-...`)
 *   - an attachment name (`DATABASE`)
 *   - a config var (`DATABASE_URL`)
 *   - an app-scoped attachment name or config var (`my-app::DATABASE`,
 *    `my-app::DATABASE_URL`)
 *
 * To resolve just the add-on the attachment points to, use `resolveAddon`.
 *
 * Always sends `Accept-Inclusion: addon:plan` on the resolve request so
 * matches come back with their add-on's plan, needed to filter by
 * `addonService`.
 */
export async function resolveAddonAttachment(
  ctx: Pick<ResourceCtx, 'platform'>,
  appIdentity: string,
  attachmentName: string,
  options: AddonAttachmentOptions = {},
): Promise<ResolvedAddOnAttachment> {
  const {addonService, signal} = options

  signal?.throwIfAborted()
  debug('resolveAddonAttachment app=%s attachment=%s service=%s', appIdentity, attachmentName, addonService ?? '<any>')

  const platform = ctx.platform
    .withHeaders({'Accept-Inclusion': 'addon:plan'})
    .withOptions({signal})

  try {
    const matches = await platform.addOnAttachment.resolution({
      // eslint-disable-next-line camelcase
      addon_attachment: attachmentName,
      app: appIdentity,
    }) as AddOnAttachmentWithDetails[]

    const filtered = addonService
      ? matches.filter(match => match.addon?.plan?.name?.split(':', 2)[0] === addonService)
      : matches
    debug('resolveAddonAttachment matches=%d filtered=%d (service=%s)', matches.length, filtered.length, addonService ?? '<any>')

    return singularize(filtered)
  } catch (error) {
    if (isAddOnAttachmentNotFound(error)) {
      throw new AddonAttachmentNotFoundError()
    }

    throw error
  }
}

function singularize(matches: AddOnAttachmentWithDetails[]): ResolvedAddOnAttachment {
  if (matches.length === 0) {
    throw new AddonAttachmentNotFoundError()
  }

  if (matches.length > 1) {
    throw new AddonAttachmentAmbiguousError(matches)
  }

  const match = matches[0]
  if (!match?.addon?.id || !match.addon.app?.id) {
    debug('resolveAddonAttachment matches=1 (no usable add-on returned)')
    throw new AddonAttachmentNotFoundError()
  }

  debug('resolveAddonAttachment resolved attachment=%s addon=%s app=%s', match.id, match.addon.id, match.addon.app.id)
  return match as ResolvedAddOnAttachment
}

function isAddOnAttachmentNotFound(error: unknown): boolean {
  return error instanceof NotFoundError && error.resource === 'add_on attachment'
}

