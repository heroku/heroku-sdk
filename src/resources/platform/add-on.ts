import type {AddOn, AddOnAttachment, Plan} from '@heroku/types/3.sdk'

import type {ResourceCtx} from '../../core/extend-resource.js'
import type {PlatformClient} from '../../services/platform.js'

import {NotFoundError} from '@heroku/api-client'

import {extendResource} from '../../core/extend-resource.js'

export type AddOnOptions = {
  signal?: AbortSignal
}

export type ResolveAddonOptions = AddOnOptions & {
  addonService?: string
  appIdentity?: string
}

/**
 * An add-on whose `app.id` and `id` are guaranteed non-null. This is what
 * the Platform's resolver returns for a successful match, but the schema
 * types both as optional. `singularize` enforces it at runtime so callers
 * can rely on the narrower type.
 */
export type ResolvedAddOn = AddOn & {
  app: AddOn['app'] & {id: string}
  id: string
}

export type DescribedAddOn = ResolvedAddOn & {
  attachments: AddOnAttachment[]
}

export class AddonNotFoundError extends Error {
  public readonly id = 'not_found'
  public readonly statusCode = 404

  constructor(public readonly resource: string = 'addon') {
    super(`Couldn't find that ${resource}.`)
    this.name = 'AddonNotFoundError'
  }

  public get body() {
    return {id: this.id, message: this.message, resource: this.resource}
  }
}

export class AddonAmbiguousError extends Error {
  public readonly id = 'multiple_matches'
  public readonly statusCode = 422

  constructor(public readonly matches: AddOn[]) {
    super(`Ambiguous identifier; multiple matching add-ons found: ${matches.map(m => m.name).join(', ')}.`)
    this.name = 'AddonAmbiguousError'
  }

  public get body() {
    return {id: this.id, message: this.message}
  }
}

/**
 * Change the plan of an add-on.
 *
 * Resolves the add-on first so the caller can pass any identifier
 * (UUID, globally unique name, or namespaced `service::name`). When
 * `appIdentity` is provided, the resolve is scoped to that app and
 * falls back to a global resolve if the platform returns 404 add_on.
 */
export async function upgrade(
  ctx: Pick<ResourceCtx, 'platform'>,
  addonIdentity: string,
  plan: string,
  options: ResolveAddonOptions = {},
): Promise<AddOn> {
  options.signal?.throwIfAborted()

  const addon = await resolveAddonInternal(ctx.platform, addonIdentity, {
    addonService: options.addonService,
    appIdentity: options.appIdentity,
  })

  options.signal?.throwIfAborted()
  return ctx.platform.addOn.update(addon.app.id, addon.id, {plan})
}

/**
 * List the plans available for an add-on service, sorted ascending by
 * `price.cents`. Plans without a price (or with equal prices) are
 * returned later in the list.
 */
export async function listPlans(
  ctx: Pick<ResourceCtx, 'platform'>,
  serviceIdentity: string,
  options: AddOnOptions = {},
): Promise<Plan[]> {
  options.signal?.throwIfAborted()
  const plans = await ctx.platform.plan.listByAddOn(serviceIdentity)
  return [...plans].sort(byPriceCentsAsc)
}

function byPriceCentsAsc(a: Plan, b: Plan): number {
  return sortableCents(a) - sortableCents(b)
}

function sortableCents(plan: Plan): number {
  const cents = plan.price?.cents
  return typeof cents === 'number' ? cents : Number.MAX_SAFE_INTEGER
}

/**
 * Resolve, describe, and decorate an add-on for display.
 *
 * - Resolves the add-on by identity (optionally scoped to an app).
 * - Loads the add-on's attachments.
 * - Mutates `plan.price` so it reflects any grandfathered/billed pricing.
 *
 * If `appIdentity` is provided and the platform returns 404 (resource
 * `add_on`), the resolve falls back to a global lookup. This handles
 * the case where the add-on belongs to a different app than the one
 * supplied.
 */
export async function describeAddon(
  ctx: Pick<ResourceCtx, 'platform'>,
  addonIdentity: string,
  options: ResolveAddonOptions = {},
): Promise<DescribedAddOn> {
  options.signal?.throwIfAborted()

  const addon = await resolveAddonInternal(ctx.platform, addonIdentity, {
    addonService: options.addonService,
    appIdentity: options.appIdentity,
  })

  options.signal?.throwIfAborted()
  const attachments = await ctx.platform.addOnAttachment.listByAddOn(addon.id)

  const plan = addon.plan as Plan | undefined
  return {
    ...addon,
    ...(plan && {plan: {...plan, price: grandfatheredPrice(addon)} as AddOn['plan']}),
    attachments,
  }
}

/**
 * Resolve a Platform add-on by identity.
 *
 * The add-on identity may be:
 *   - a UUID (`d5e3f2a4-...`)
 *   - a globally-unique name (`postgres-curved-12345`)
 *   - a namespaced credential reference (`postgres-curved-12345::SECONDARY`)
 *
 * When `appIdentity` is provided, the resolve is scoped to that app first
 * and falls back to a global resolve if the platform returns 404 add_on.
 * Namespaced identities (containing `::`) skip the app-scoped lookup
 * because they are globally unique.
 *
 * `addonService` (e.g. `heroku-postgresql`) is filtered client-side after
 * the resolve. The platform's server-side `addon_service` filter excludes
 * alpha add-ons, so we don't pass it through.
 *
 * Errors:
 *   - throws `AddonNotFoundError` if no match is found
 *   - throws `AddonAmbiguousError` if multiple matches remain after filtering
 *
 * For attachment-based resolution (e.g. `DATABASE_URL` on a particular
 * app), use `resolveAddonByAttachment` instead.
 */
export async function resolveAddon(
  ctx: Pick<ResourceCtx, 'platform'>,
  addonIdentity: string,
  options: ResolveAddonOptions = {},
): Promise<ResolvedAddOn> {
  options.signal?.throwIfAborted()
  return resolveAddonInternal(ctx.platform, addonIdentity, options)
}

/**
 * Resolve a Platform add-on via one of its attachments on a given app.
 *
 * Use this when you have an attachment name (e.g. `DATABASE_URL`,
 * `HEROKU_POSTGRESQL_GREEN`) on a known app, rather than an add-on
 * identity. Calls `addOnAttachment.resolution` and returns the add-on
 * the matched attachment points to.
 *
 * For resolving by add-on identity, use `resolveAddon`.
 */
export async function resolveAddonByAttachment(
  ctx: Pick<ResourceCtx, 'platform'>,
  appIdentity: string,
  attachmentName: string,
  options: AddOnOptions = {},
): Promise<ResolvedAddOn> {
  options.signal?.throwIfAborted()
  const matches = await ctx.platform.addOnAttachment.resolution({
    // eslint-disable-next-line camelcase
    addon_attachment: attachmentName,
    app: appIdentity,
  })

  const attachment = matches[0]
  const addon = attachment?.addon
  if (!addon?.id || !addon.app?.id) {
    throw new AddonNotFoundError()
  }

  return addon as ResolvedAddOn
}

async function resolveAddonInternal(
  platform: PlatformClient,
  addonIdentity: string,
  options: {addonService?: string; appIdentity?: string} = {},
): Promise<ResolvedAddOn> {
  const {addonService, appIdentity} = options

  const resolveBy = async (app?: string): Promise<ResolvedAddOn> => {
    const body = app ? {addon: addonIdentity, app} : {addon: addonIdentity}
    const matches = await platform.addOn.resolution(body)
    const filtered = addonService
      ? matches.filter(addon => addon.addon_service?.name === addonService)
      : matches
    return singularize(filtered)
  }

  if (!appIdentity || addonIdentity.includes('::')) {
    return resolveBy()
  }

  try {
    return await resolveBy(appIdentity)
  } catch (error) {
    if (await isAddOnNotFound(error)) {
      return resolveBy()
    }

    throw error
  }
}

async function isAddOnNotFound(error: unknown): Promise<boolean> {
  if (!(error instanceof NotFoundError) || !error.response) {
    return false
  }

  try {
    const body = await error.response.clone().json() as {resource?: string}
    return body.resource === 'add_on'
  } catch {
    return false
  }
}

function singularize(matches: AddOn[]): ResolvedAddOn {
  if (matches.length === 0) {
    throw new AddonNotFoundError()
  }

  if (matches.length > 1) {
    throw new AddonAmbiguousError(matches)
  }

  const match = matches[0]
  if (!match.id || !match.app?.id) {
    throw new Error(`Resolved add-on is missing required fields (id=${match.id}, app.id=${match.app?.id})`)
  }

  return match as ResolvedAddOn
}

function grandfatheredPrice(addon: AddOn): Plan['price'] {
  const price = (addon.plan as Plan | undefined)?.price
  return {
    ...price,
    cents: addon.billed_price?.cents,
    contract: addon.billed_price?.contract,
  }
}

export const addOnExtensions = extendResource('platform', 'addOn', ctx => ({
  describe: (addonIdentity: string, options?: ResolveAddonOptions) =>
    describeAddon(ctx, addonIdentity, options),
  listPlans: (serviceIdentity: string, options?: AddOnOptions) =>
    listPlans(ctx, serviceIdentity, options),
  resolve: (addonIdentity: string, options?: ResolveAddonOptions) =>
    resolveAddon(ctx, addonIdentity, options),
  resolveByAttachment: (appIdentity: string, attachmentName: string, options?: AddOnOptions) =>
    resolveAddonByAttachment(ctx, appIdentity, attachmentName, options),
  upgrade: (addonIdentity: string, plan: string, options?: ResolveAddonOptions) =>
    upgrade(ctx, addonIdentity, plan, options),
}))
