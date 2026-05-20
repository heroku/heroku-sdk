import type {HerokuApiClientOptions} from '@heroku/heroku-fetch'
import type {AddOn, AddOnAttachment, Plan} from '@heroku/types/3.sdk'

import {NotFoundError} from '@heroku/heroku-fetch'

import {createPlatformClient} from '../services/platform.js'

type PlatformClient = ReturnType<typeof createPlatformClient>

export type AddOnOptions = {
  clientOptions?: HerokuApiClientOptions
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
 *
 * If `plan` is unqualified (no `:`), it's prefixed with the resolved
 * add-on's `addon_service.name` — so callers can pass `hobby` rather
 * than `heroku-redis:hobby` if they don't already know the service.
 *
 * `options.onResolved` fires after the resolve and before the update,
 * receiving the resolved add-on. Useful for surfacing pre-update
 * state (the add-on's current plan, app, etc.) without an extra
 * round-trip.
 */
export async function upgrade(
  addonIdentity: string,
  plan: string,
  options: ResolveAddonOptions & {
    onResolved?: (addon: ResolvedAddOn) => Promise<void> | void
  } = {},
): Promise<AddOn> {
  options.signal?.throwIfAborted()
  const client = createPlatformClient(options.clientOptions)

  const addon = await resolveAddonInternal(client, addonIdentity, {
    addonService: options.addonService,
    appIdentity: options.appIdentity,
  })

  await options.onResolved?.(addon)

  options.signal?.throwIfAborted()
  const qualifiedPlan = plan.includes(':')
    ? plan
    : `${(addon.addon_service as undefined | {name?: string})?.name}:${plan}`
  return client.addOn.update(addon.app.id, addon.id, {plan: qualifiedPlan})
}

/**
 * List the plans available for an add-on service, sorted ascending by
 * `price.cents`. Plans without a price (or with equal prices) are
 * returned later in the list.
 */
export async function listPlans(
  serviceIdentity: string,
  options: AddOnOptions = {},
): Promise<Plan[]> {
  options.signal?.throwIfAborted()
  const client = createPlatformClient(options.clientOptions)
  const plans = await client.plan.listByAddOn(serviceIdentity)
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
 * - Returns a copy with `plan.price` set from `billed_price` (so the
 *   value reflects any grandfathered/contract pricing).
 *
 * If `appIdentity` is provided and the platform returns 404 (resource
 * `add_on`), the resolve falls back to a global lookup. This handles
 * the case where the add-on belongs to a different app than the one
 * supplied.
 *
 * Requests the `version=3.sdk` accept variant with
 * `addon_service,plan` expansion so the resolved add-on includes the
 * full `Plan` shape (`price.unit`, etc.) needed to render pricing.
 */
export async function describeAddon(
  addonIdentity: string,
  options: ResolveAddonOptions = {},
): Promise<DescribedAddOn> {
  options.signal?.throwIfAborted()
  const client = createPlatformClient({
    ...options.clientOptions,
    headers: {
      Accept: 'application/vnd.heroku+json; version=3.sdk',
      'Accept-Expansion': 'addon_service,plan',
      ...options.clientOptions?.headers,
    },
  })

  const addon = await resolveAddonInternal(client, addonIdentity, {
    addonService: options.addonService,
    appIdentity: options.appIdentity,
  })

  options.signal?.throwIfAborted()
  const attachments = await client.addOnAttachment.listByAddOn(addon.id)

  const plan = addon.plan as Plan | undefined
  return {
    ...addon,
    ...(plan && {plan: {...plan, price: grandfatheredPrice(addon)}}),
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
 * For Heroku Postgres input shapes (attachment names like
 * `DATABASE_URL`, `parent-app::branch-name` references, etc.) use
 * `resolvePgDatabase` (in `pg.ts`); it routes those shapes to the
 * appropriate resolver.
 *
 * For attachment-based resolution (e.g. `DATABASE_URL` on a particular
 * app), use `resolveAddonByAttachment` instead.
 */
export async function resolveAddon(
  addonIdentity: string,
  options: ResolveAddonOptions = {},
): Promise<ResolvedAddOn> {
  options.signal?.throwIfAborted()
  const client = createPlatformClient(options.clientOptions)
  return resolveAddonInternal(client, addonIdentity, options)
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
  appIdentity: string,
  attachmentName: string,
  options: AddOnOptions = {},
): Promise<ResolvedAddOn> {
  options.signal?.throwIfAborted()
  const client = createPlatformClient(options.clientOptions)
  const matches = await client.addOnAttachment.resolution({
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
  client: PlatformClient,
  addonIdentity: string,
  options: {addonService?: string; appIdentity?: string} = {},
): Promise<ResolvedAddOn> {
  const {addonService, appIdentity} = options

  const resolveBy = async (app?: string): Promise<ResolvedAddOn> => {
    const body = app ? {addon: addonIdentity, app} : {addon: addonIdentity}
    const matches = await client.addOn.resolution(body)
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
    if (isAddOnNotFound(error)) {
      return resolveBy()
    }

    throw error
  }
}

function isAddOnNotFound(error: unknown): boolean {
  return error instanceof NotFoundError && error.resource === 'add_on'
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
