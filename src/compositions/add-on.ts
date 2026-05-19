import type {HerokuApiClientOptions} from '@heroku/api-client'
import type {AddOn, AddOnAttachment, Plan} from '@heroku/types/3.sdk'

import {NotFoundError} from '@heroku/api-client'

import {createPlatformClient} from '../services/platform.js'

type PlatformClient = ReturnType<typeof createPlatformClient>

export type AddOnOptions = {
  clientOptions?: HerokuApiClientOptions
  signal?: AbortSignal
}

export type DescribedAddOn = AddOn & {
  attachments: AddOnAttachment[]
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
  addonIdentity: string,
  plan: string,
  options: AddOnOptions & {appIdentity?: string} = {},
): Promise<AddOn> {
  options.signal?.throwIfAborted()
  const client = createPlatformClient(options.clientOptions)

  const addon = await resolveAddon(client, addonIdentity, options.appIdentity)

  options.signal?.throwIfAborted()
  return client.addOn.update(addon.app!.id!, addon.id, {plan})
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
 * - Mutates `plan.price` so it reflects any grandfathered/billed pricing.
 *
 * If `appIdentity` is provided and the platform returns 404 (resource
 * `add_on`), falls back to a global resolve. This matches the behavior
 * of `heroku addons:info` when the user passes `--app` but the add-on
 * is owned by a different app.
 */
export async function describeAddon(
  addonIdentity: string,
  options: AddOnOptions & {appIdentity?: string} = {},
): Promise<DescribedAddOn> {
  options.signal?.throwIfAborted()
  const client = createPlatformClient(options.clientOptions)

  const addon = await resolveAddon(client, addonIdentity, options.appIdentity)

  options.signal?.throwIfAborted()
  const attachments = await client.addOnAttachment.listByAddOn(addon.id)

  const plan = addon.plan as Plan | undefined
  if (plan) {
    plan.price = grandfatheredPrice(addon)
    addon.plan = plan
  }

  return Object.assign(addon, {attachments})
}

async function resolveAddon(
  client: PlatformClient,
  addonIdentity: string,
  appIdentity?: string,
): Promise<AddOn> {
  const resolveBy = async (app?: string): Promise<AddOn> => {
    const body = app ? {addon: addonIdentity, app} : {addon: addonIdentity}
    const matches = await client.addOn.resolution(body)
    return singularize(matches)
  }

  // A namespaced identity (`service::name`) is globally resolvable; skip the
  // app-scoped lookup. Same when no app was provided.
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

function singularize(matches: AddOn[]): AddOn {
  if (matches.length === 0) {
    const error = new Error('Couldn\'t find that add-on.')
    Object.assign(error, {id: 'not_found', statusCode: 404})
    throw error
  }

  if (matches.length === 1) {
    return matches[0]
  }

  const names = matches.map(m => m.name).join(', ')
  const error = new Error(`Ambiguous identifier; multiple matching add-ons found: ${names}.`)
  Object.assign(error, {id: 'multiple_matches', matches, statusCode: 422})
  throw error
}

function grandfatheredPrice(addon: AddOn): Plan['price'] {
  const price = (addon.plan as Plan | undefined)?.price
  return {
    ...price,
    cents: addon.billed_price?.cents,
    contract: addon.billed_price?.contract,
  }
}
