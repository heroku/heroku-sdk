import type {
  AddOn, AddOnAttachment, AddOnCreateOpts, Plan,
} from '@heroku/types/3.sdk'

import {HerokuApiError, NotFoundError} from '@heroku/heroku-fetch'
import createDebug from 'debug'

import type {ResourceCtx} from '../../core/extend-resource.js'
import type {PlatformClient} from '../../services/platform.js'

import {extendResource} from '../../core/extend-resource.js'

const debug = createDebug('heroku:sdk:resources:add-on')

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

export type UpgradeAddOnOptions = ResolveAddonOptions & {
  onResolved?: (addon: ResolvedAddOn) => Promise<void> | void
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
 * Thrown by `createAndWait` when the Platform returns 423
 * `confirmation_required`. Callers that want to prompt the user should
 * catch this, gather a confirmation value, and retry the call with
 * `body.confirm` set.
 */
export class AddonConfirmationRequiredError extends Error {
  public readonly id = 'confirmation_required'
  public readonly statusCode = 423

  constructor(public readonly platformMessage: string) {
    super(platformMessage)
    this.name = 'AddonConfirmationRequiredError'
  }

  public get body() {
    return {id: this.id, message: this.message}
  }
}

/**
 * Thrown by `createAndWait` when the Platform reports the add-on
 * settled into a non-provisioned terminal state (e.g. `deprovisioned`).
 */
export class AddonProvisioningFailedError extends Error {
  public readonly id = 'provisioning_failed'

  constructor(public readonly addon: AddOn) {
    super(`The add-on was unable to be created, with status ${addon.state}.`)
    this.name = 'AddonProvisioningFailedError'
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
  ctx: Pick<ResourceCtx, 'platform'>,
  addonIdentity: string,
  plan: string,
  options: UpgradeAddOnOptions = {},
): Promise<AddOn> {
  options.signal?.throwIfAborted()

  const addon = await resolveAddonInternal(ctx.platform, addonIdentity, {
    addonService: options.addonService,
    appIdentity: options.appIdentity,
  })

  await options.onResolved?.(addon)

  options.signal?.throwIfAborted()
  const qualifiedPlan = plan.includes(':')
    ? plan
    : `${(addon.addon_service as undefined | {name?: string})?.name}:${plan}`
  if (qualifiedPlan !== plan) {
    debug('upgrade plan qualified plan=%s qualified=%s', plan, qualifiedPlan)
  }

  debug('upgrade addon=%s app=%s plan=%s', addon.id, addon.app.id, qualifiedPlan)
  return ctx.platform.addOn.update(addon.app.id, addon.id, {plan: qualifiedPlan})
}

export type CreateAndWaitOptions = {
  /**
   * Fires once after the initial create returns and the add-on is
   * still provisioning, before the first poll. Receives the create
   * response. Useful for surfacing two-phase UX: e.g. "Creating
   * <plan>... <price>" followed by "Waiting for <addonName>...".
   *
   * Only invoked when `wait: true` and the create response state is
   * `provisioning`.
   */
  onProvisioning?: (addon: AddOn) => Promise<void> | void
  /**
   * If true, poll until the add-on leaves the `provisioning` state. If
   * the final state is anything other than `provisioned`/`provisioning`
   * (e.g. `deprovisioned`), throws `AddonProvisioningFailedError`.
   *
   * If false (the default), returns immediately after the create call —
   * even if the add-on is still provisioning.
   */
  wait?: boolean
  /** Polling interval in milliseconds. Defaults to 5000. */
  waitIntervalMs?: number
} & AddOnOptions

const DEFAULT_CREATE_WAIT_INTERVAL_MS = 5000

/**
 * Create an add-on and optionally wait for provisioning to complete.
 *
 * Wraps `addOn.create` with three pieces of orchestration:
 *
 *   - 423 `confirmation_required` from the platform is converted to a
 *     typed `AddonConfirmationRequiredError`. Callers should catch
 *     this, prompt the user for confirmation, and retry the call with
 *     `body.confirm` set.
 *   - When `wait: true` is set, polls `addOn.infoByApp` on a
 *     `waitIntervalMs` cadence until the add-on's `state` is no longer
 *     `provisioning`. Throws `AddonProvisioningFailedError` if the
 *     terminal state is `deprovisioned`.
 *   - `options.onProvisioning` fires once after the create response
 *     when polling is about to begin, letting callers surface a
 *     two-phase status display ("Created" → "Waiting").
 */
export async function createAndWait(
  ctx: Pick<ResourceCtx, 'platform'>,
  appIdentity: string,
  body: AddOnCreateOpts,
  options: CreateAndWaitOptions = {},
): Promise<AddOn> {
  options.signal?.throwIfAborted()

  let addon: AddOn
  try {
    addon = await ctx.platform.addOn.create(appIdentity, body)
  } catch (error) {
    if (error instanceof HerokuApiError && error.id === 'confirmation_required') {
      throw new AddonConfirmationRequiredError(error.message)
    }

    throw error
  }

  if (!options.wait || addon.state !== 'provisioning') {
    if (addon.state === 'deprovisioned') {
      throw new AddonProvisioningFailedError(addon)
    }

    return addon
  }

  await options.onProvisioning?.(addon)

  const intervalMs = options.waitIntervalMs ?? DEFAULT_CREATE_WAIT_INTERVAL_MS
  const platform = ctx.platform.withHeaders({'Accept-Expansion': 'addon_service,plan'})

  while (addon.state === 'provisioning') {
    options.signal?.throwIfAborted()
    // eslint-disable-next-line no-await-in-loop
    await wait(intervalMs, options.signal)
    // eslint-disable-next-line no-await-in-loop
    addon = await platform.addOn.infoByApp(appIdentity, addon.name!)
  }

  if (addon.state === 'deprovisioned') {
    throw new AddonProvisioningFailedError(addon)
  }

  return addon
}

function wait(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    function onAbort() {
      clearTimeout(timer)
      reject(signal!.reason ?? new Error('Aborted'))
    }

    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)

    if (signal) {
      if (signal.aborted) {
        clearTimeout(timer)
        reject(signal.reason ?? new Error('Aborted'))
        return
      }

      signal.addEventListener('abort', onAbort, {once: true})
    }
  })
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
 * - Returns a copy with `plan.price` set from `billed_price` (so the
 *   value reflects any grandfathered/contract pricing).
 *
 * If `appIdentity` is provided and the platform returns 404 (resource
 * `add_on`), the resolve falls back to a global lookup. This handles
 * the case where the add-on belongs to a different app than the one
 * supplied.
 *
 * Requests the `version=3.sdk` accept variant with `addon_service,plan`
 * expansion so the resolved add-on includes the full `Plan` shape
 * (`price.unit`, etc.) needed to render pricing.
 */
export async function describeAddon(
  ctx: Pick<ResourceCtx, 'platform'>,
  addonIdentity: string,
  options: ResolveAddonOptions = {},
): Promise<DescribedAddOn> {
  options.signal?.throwIfAborted()

  const platform = ctx.platform.withHeaders({
    Accept: 'application/vnd.heroku+json; version=3.sdk',
    'Accept-Expansion': 'addon_service,plan',
  })

  const addon = await resolveAddonInternal(platform, addonIdentity, {
    addonService: options.addonService,
    appIdentity: options.appIdentity,
  })

  options.signal?.throwIfAborted()
  const attachments = await platform.addOnAttachment.listByAddOn(addon.id)

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
  debug('resolveByAttachment app=%s attachment=%s', appIdentity, attachmentName)
  const matches = await ctx.platform.addOnAttachment.resolution({
    // eslint-disable-next-line camelcase
    addon_attachment: attachmentName,
    app: appIdentity,
  })

  const attachment = matches[0]
  const addon = attachment?.addon
  if (!addon?.id || !addon.app?.id) {
    debug('resolveByAttachment matches=%d (no usable add-on returned)', matches.length)
    throw new AddonNotFoundError()
  }

  debug('resolveByAttachment resolved addon=%s app=%s', addon.id, addon.app.id)
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
    debug('resolve addon=%s app=%s service=%s', addonIdentity, app ?? '<global>', addonService ?? '<any>')
    const matches = await platform.addOn.resolution(body)
    const filtered = addonService
      ? matches.filter(addon => addon.addon_service?.name === addonService)
      : matches
    debug('resolve matches=%d filtered=%d (service=%s)', matches.length, filtered.length, addonService ?? '<any>')
    const resolvedAddon = singularize(filtered)
    debug('resolve resolved addon=%s app=%s', resolvedAddon.id, resolvedAddon.app.id)
    return resolvedAddon
  }

  if (!appIdentity || addonIdentity.includes('::')) {
    debug('resolve scope=global reason=%s', appIdentity ? 'namespaced-identity' : 'no-app')
    return resolveBy()
  }

  try {
    return await resolveBy(appIdentity)
  } catch (error) {
    if (isAddOnNotFound(error)) {
      debug('resolve app-scope 404 add_on, falling back to global addon=%s', addonIdentity)
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

export const addOnExtensions = extendResource('platform', 'addOn', ctx => ({
  createAndWait: (appIdentity: string, body: AddOnCreateOpts, options?: CreateAndWaitOptions) =>
    createAndWait(ctx, appIdentity, body, options),
  describe: (addonIdentity: string, options?: ResolveAddonOptions) =>
    describeAddon(ctx, addonIdentity, options),
  listPlans: (serviceIdentity: string, options?: AddOnOptions) =>
    listPlans(ctx, serviceIdentity, options),
  resolve: (addonIdentity: string, options?: ResolveAddonOptions) =>
    resolveAddon(ctx, addonIdentity, options),
  resolveByAttachment: (appIdentity: string, attachmentName: string, options?: AddOnOptions) =>
    resolveAddonByAttachment(ctx, appIdentity, attachmentName, options),
  upgrade: (addonIdentity: string, plan: string, options?: UpgradeAddOnOptions) =>
    upgrade(ctx, addonIdentity, plan, options),
}))
