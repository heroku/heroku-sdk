import type {AddOn, AddOnAttachment, Plan} from '@heroku/types/3.sdk'

import {HerokuApiError, NotFoundError} from '@heroku/heroku-fetch'
import {
  afterEach, describe, expect, it, vi,
} from 'vitest'

import type {ResourceCtx} from '../../../core/extend-resource.js'

import {
  AddonAmbiguousError,
  AddonConfirmationRequiredError,
  addOnExtensions,
  AddonNotFoundError,
  AddonProvisioningFailedError,
  createAndWait,
  describeAddon,
  destroyAndWait,
  formatPlanPriceLabel,
  listPlans,
  listPlansForAddon,
  priceForPlan,
  resolveAddon,
  resolveAddonByAttachment,
  resolveAttachment,
  upgrade,
  waitForProvisioning,
} from './index.js'

function buildAddon(overrides: Partial<AddOn> = {}): AddOn {
  return {
    app: {id: 'app-id', name: 'my-app'},
    // eslint-disable-next-line camelcase
    billed_price: {cents: 5000, contract: false},
    id: 'addon-id',
    name: 'my-postgres',
    plan: {id: 'plan-id', name: 'heroku-postgresql:standard-0', price: {cents: 5000, unit: 'month'}},
    ...overrides,
  } as AddOn
}

function buildCtx({
  attachments = [],
  plans,
  resolveByAttachmentResponses,
  resolveResponses = [],
  updateResponse,
}: {
  attachments?: AddOnAttachment[]
  plans?: Plan[]
  resolveByAttachmentResponses?: AddOnAttachment[]
  resolveResponses?: Array<AddOn[] | Error>
  updateResponse?: AddOn
} = {}): {
  ctx: ResourceCtx
  listByAddOn: ReturnType<typeof vi.fn>
  listByAddOnService: ReturnType<typeof vi.fn>
  resolution: ReturnType<typeof vi.fn>
  resolutionByAttachment: ReturnType<typeof vi.fn>
  update: ReturnType<typeof vi.fn>
  withHeaders: ReturnType<typeof vi.fn>
} {
  const resolution = vi.fn()
  for (const response of resolveResponses) {
    if (response instanceof Error) {
      resolution.mockRejectedValueOnce(response)
    } else {
      resolution.mockResolvedValueOnce(response)
    }
  }

  const resolutionByAttachment = vi.fn().mockResolvedValue(resolveByAttachmentResponses ?? [])
  const listByAddOn = vi.fn().mockResolvedValue(attachments)
  const listByAddOnService = vi.fn().mockResolvedValue(plans ?? [])
  const update = vi.fn().mockResolvedValue(updateResponse ?? {})

  const platform = {
    addOn: {resolution, update},
    addOnAttachment: {listByAddOn, resolution: resolutionByAttachment},
    plan: {listByAddOn: listByAddOnService},
    withHeaders: vi.fn(),
  }
  // withHeaders should return a same-shaped client; our mock is self-referential.
  platform.withHeaders.mockReturnValue(platform)

  return {
    ctx: {
      data: {} as never,
      platform: platform as never,
    },
    listByAddOn,
    listByAddOnService,
    resolution,
    resolutionByAttachment,
    update,
    withHeaders: platform.withHeaders,
  }
}

function buildNotFound(resource = 'add_on'): NotFoundError {
  const response = new Response(JSON.stringify({id: 'not_found', resource}), {
    headers: {'content-type': 'application/json'},
    status: 404,
  })
  return new NotFoundError(response, {id: 'not_found', resource})
}

function buildCreateCtx({
  createResponses,
  infoByAppResponses = [],
}: {
  createResponses: Array<AddOn | Error>
  infoByAppResponses?: AddOn[]
}): {
  create: ReturnType<typeof vi.fn>
  ctx: ResourceCtx
  infoByApp: ReturnType<typeof vi.fn>
  withHeaders: ReturnType<typeof vi.fn>
} {
  const create = vi.fn()
  for (const response of createResponses) {
    if (response instanceof Error) {
      create.mockRejectedValueOnce(response)
    } else {
      create.mockResolvedValueOnce(response)
    }
  }

  const infoByApp = vi.fn()
  for (const response of infoByAppResponses) {
    infoByApp.mockResolvedValueOnce(response)
  }

  const platform = {
    addOn: {create, infoByApp},
    withHeaders: vi.fn(),
  }
  platform.withHeaders.mockReturnValue(platform)

  return {
    create,
    ctx: {data: {} as never, platform: platform as never},
    infoByApp,
    withHeaders: platform.withHeaders,
  }
}

function buildWaitCtx({
  infoByAppResponses = [],
  infoResponses = [],
}: {
  infoByAppResponses?: AddOn[]
  infoResponses?: AddOn[]
} = {}): {
  ctx: ResourceCtx
  info: ReturnType<typeof vi.fn>
  infoByApp: ReturnType<typeof vi.fn>
  withHeaders: ReturnType<typeof vi.fn>
} {
  const infoByApp = vi.fn()
  for (const response of infoByAppResponses) {
    infoByApp.mockResolvedValueOnce(response)
  }

  const info = vi.fn()
  for (const response of infoResponses) {
    info.mockResolvedValueOnce(response)
  }

  const platform = {
    addOn: {info, infoByApp},
    withHeaders: vi.fn(),
  }
  platform.withHeaders.mockReturnValue(platform)

  return {
    ctx: {data: {} as never, platform: platform as never},
    info,
    infoByApp,
    withHeaders: platform.withHeaders,
  }
}

function buildDestroyCtx({infoByAppResponses = []}: {
  infoByAppResponses?: Array<AddOn | Error>
} = {}): {
  addOnDelete: ReturnType<typeof vi.fn>
  ctx: ResourceCtx
  infoByApp: ReturnType<typeof vi.fn>
  withHeaders: ReturnType<typeof vi.fn>
  withOptions: ReturnType<typeof vi.fn>
} {
  const infoByApp = vi.fn()
  for (const response of infoByAppResponses) {
    if (response instanceof Error) {
      infoByApp.mockRejectedValueOnce(response)
    } else {
      infoByApp.mockResolvedValueOnce(response)
    }
  }

  const addOnDelete = vi.fn()
  const platform = {
    addOn: {delete: addOnDelete, infoByApp},
    withHeaders: vi.fn(),
    withOptions: vi.fn(),
  }
  // Both decorators return a same-shaped client; the mocks are self-referential
  // so the `.withHeaders(...).withOptions(...)` chain resolves back to platform.
  platform.withHeaders.mockReturnValue(platform)
  platform.withOptions.mockReturnValue(platform)

  return {
    addOnDelete,
    ctx: {data: {} as never, platform: platform as never},
    infoByApp,
    withHeaders: platform.withHeaders,
    withOptions: platform.withOptions,
  }
}

describe('add-on resource', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('upgrade', () => {
    it('resolves the addon then calls addOn.update with the plan', async () => {
      const resolved = buildAddon({app: {id: 'app-1', name: 'my-app'}, id: 'addon-1', name: 'kafka-swiftly-123'})
      const updated = buildAddon({id: 'addon-1', name: 'kafka-swiftly-123'})
      const {ctx, resolution, update} = buildCtx({
        resolveResponses: [[resolved]],
        updateResponse: updated,
      })

      const result = await upgrade(ctx, 'kafka-swiftly-123', 'heroku-kafka:hobby', {appIdentity: 'my-app'})

      expect(resolution).toHaveBeenCalledExactlyOnceWith({addon: 'kafka-swiftly-123', app: 'my-app'})
      expect(update).toHaveBeenCalledExactlyOnceWith('app-1', 'addon-1', {plan: 'heroku-kafka:hobby'})
      expect(result).toBe(updated)
    })

    it('resolves globally when no appIdentity is provided', async () => {
      const resolved = buildAddon({app: {id: 'app-1', name: 'my-app'}, id: 'addon-1'})
      const {ctx, resolution, update} = buildCtx({
        resolveResponses: [[resolved]],
        updateResponse: resolved,
      })

      await upgrade(ctx, 'postgres::sushi', 'heroku-postgresql:premium-0')

      expect(resolution).toHaveBeenCalledExactlyOnceWith({addon: 'postgres::sushi'})
      expect(update).toHaveBeenCalledWith('app-1', 'addon-1', {plan: 'heroku-postgresql:premium-0'})
    })

    it('throws if the abort signal is already aborted', async () => {
      const {ctx, resolution} = buildCtx()
      const controller = new AbortController()
      controller.abort()

      await expect(upgrade(ctx, 'addon-1', 'plan-1', {signal: controller.signal})).rejects.toThrow()
      expect(resolution).not.toHaveBeenCalled()
    })

    it('qualifies a bare plan name with the resolved addon_service name', async () => {
      const resolved = buildAddon({
        // eslint-disable-next-line camelcase
        addon_service: {name: 'heroku-redis'},
        app: {id: 'app-1', name: 'my-app'},
        id: 'addon-1',
      })
      const {ctx, update} = buildCtx({
        resolveResponses: [[resolved]],
        updateResponse: resolved,
      })

      await upgrade(ctx, 'redis-curved-12345', 'hobby', {appIdentity: 'my-app'})

      expect(update).toHaveBeenCalledWith('app-1', 'addon-1', {plan: 'heroku-redis:hobby'})
    })

    it('passes an already-qualified plan through unchanged', async () => {
      const resolved = buildAddon({
        // eslint-disable-next-line camelcase
        addon_service: {name: 'heroku-redis'},
        app: {id: 'app-1', name: 'my-app'},
        id: 'addon-1',
      })
      const {ctx, update} = buildCtx({
        resolveResponses: [[resolved]],
        updateResponse: resolved,
      })

      await upgrade(ctx, 'redis-curved-12345', 'heroku-redis:premium-2', {appIdentity: 'my-app'})

      expect(update).toHaveBeenCalledWith('app-1', 'addon-1', {plan: 'heroku-redis:premium-2'})
    })

    it('calls onResolved with the resolved addon before the update', async () => {
      const resolved = buildAddon({
        // eslint-disable-next-line camelcase
        addon_service: {name: 'heroku-redis'},
        app: {id: 'app-1', name: 'my-app'},
        id: 'addon-1',
        plan: {name: 'premium-0'},
      })
      const calls: string[] = []
      const onResolved = vi.fn(addon => {
        calls.push(`onResolved:${addon.id}`)
      })
      const {ctx, update} = buildCtx({
        resolveResponses: [[resolved]],
        updateResponse: resolved,
      })
      update.mockImplementation(() => {
        calls.push('update')
        return resolved
      })

      await upgrade(ctx, 'redis-curved-12345', 'hobby', {appIdentity: 'my-app', onResolved})

      expect(onResolved).toHaveBeenCalledWith(resolved)
      expect(calls).toEqual(['onResolved:addon-1', 'update'])
    })
  })

  describe('listPlans', () => {
    it('returns plans sorted ascending by price.cents', async () => {
      const plans = [
        {id: 'p3', name: 'premium-0', price: {cents: 5000, unit: 'month'}},
        {id: 'p1', name: 'free', price: {cents: 0, unit: 'month'}},
        {id: 'p2', name: 'hobby', price: {cents: 700, unit: 'month'}},
      ] as Plan[]
      const {ctx, listByAddOnService} = buildCtx({plans})

      const result = await listPlans(ctx, 'heroku-postgresql')

      expect(listByAddOnService).toHaveBeenCalledWith('heroku-postgresql')
      expect(result.map(plan => plan.id)).toEqual(['p1', 'p2', 'p3'])
    })

    it('places plans without a price after priced plans', async () => {
      const plans = [
        {id: 'p3', name: 'premium-0', price: {cents: 5000}},
        {id: 'p4', name: 'metered', price: {metered: true}},
        {id: 'p1', name: 'free', price: {cents: 0}},
      ] as Plan[]
      const {ctx} = buildCtx({plans})

      const result = await listPlans(ctx, 'heroku-redis')

      expect(result.map(plan => plan.id)).toEqual(['p1', 'p3', 'p4'])
    })

    it('does not mutate the input list', async () => {
      const plans = [
        {id: 'p2', name: 'b', price: {cents: 100}},
        {id: 'p1', name: 'a', price: {cents: 0}},
      ] as Plan[]
      const original = [...plans]
      const {ctx} = buildCtx({plans})

      await listPlans(ctx, 'svc')

      expect(plans).toEqual(original)
    })

    it('throws if the signal is already aborted', async () => {
      const {ctx, listByAddOnService} = buildCtx()
      const controller = new AbortController()
      controller.abort()

      await expect(listPlans(ctx, 'svc', {signal: controller.signal})).rejects.toThrow()
      expect(listByAddOnService).not.toHaveBeenCalled()
    })
  })

  describe('listPlansForAddon', () => {
    it('resolves the add-on then lists plans for its service', async () => {
      const addon = buildAddon({
        // eslint-disable-next-line camelcase
        addon_service: {id: 'svc-id', name: 'heroku-postgresql'},
      } as Partial<AddOn>)
      const plans = [
        {id: 'p2', name: 'standard-0', price: {cents: 5000, unit: 'month'}},
        {id: 'p1', name: 'mini', price: {cents: 500, unit: 'month'}},
      ] as Plan[]
      const {ctx, listByAddOnService, resolution} = buildCtx({
        plans,
        resolveResponses: [[addon]],
      })

      const result = await listPlansForAddon(ctx, 'addon-id')

      // Resolve runs first; the route is given the add-on identity.
      expect(resolution).toHaveBeenCalledWith({addon: 'addon-id'})
      // Then the service name (not id) is forwarded to listPlans.
      expect(listByAddOnService).toHaveBeenCalledWith('heroku-postgresql')
      // And the result is sorted ascending.
      expect(result.map(plan => plan.id)).toEqual(['p1', 'p2'])
    })

    it('forwards appIdentity to the resolve step', async () => {
      const addon = buildAddon({
        // eslint-disable-next-line camelcase
        addon_service: {id: 'svc-id', name: 'heroku-redis'},
      } as Partial<AddOn>)
      const {ctx, resolution} = buildCtx({plans: [], resolveResponses: [[addon]]})

      await listPlansForAddon(ctx, 'addon-id', {appIdentity: 'my-app'})

      expect(resolution).toHaveBeenCalledWith({addon: 'addon-id', app: 'my-app'})
    })

    it('skips the app-scoped resolve for namespaced identities', async () => {
      const addon = buildAddon({
        // eslint-disable-next-line camelcase
        addon_service: {id: 'svc-id', name: 'heroku-postgresql'},
      } as Partial<AddOn>)
      const {ctx, resolution} = buildCtx({plans: [], resolveResponses: [[addon]]})

      await listPlansForAddon(ctx, 'postgres-curved-12345::SECONDARY', {appIdentity: 'my-app'})

      // Despite passing `appIdentity`, the namespaced identity (`::`)
      // forces a global resolve — `app` is omitted from the body.
      expect(resolution).toHaveBeenCalledExactlyOnceWith({addon: 'postgres-curved-12345::SECONDARY'})
    })

    it('throws AddonNotFoundError when resolve finds nothing', async () => {
      const {ctx} = buildCtx({resolveResponses: [[]]})

      await expect(listPlansForAddon(ctx, 'missing')).rejects.toBeInstanceOf(AddonNotFoundError)
    })

    it('throws AddonNotFoundError if the resolved add-on is missing addon_service.name', async () => {
      const addon = buildAddon({
        // eslint-disable-next-line camelcase
        addon_service: undefined as never,
      })
      const {ctx} = buildCtx({plans: [], resolveResponses: [[addon]]})

      await expect(listPlansForAddon(ctx, 'addon-id')).rejects.toBeInstanceOf(AddonNotFoundError)
    })

    it('throws if the signal is already aborted', async () => {
      const {ctx, resolution} = buildCtx()
      const controller = new AbortController()
      controller.abort()

      await expect(listPlansForAddon(ctx, 'addon-id', {signal: controller.signal})).rejects.toThrow()
      expect(resolution).not.toHaveBeenCalled()
    })
  })

  describe('priceForPlan', () => {
    it('breaks down a monthly plan into perMonth/perHour cents', () => {
      const plan = {price: {cents: 7200, contract: false, unit: 'month'}} as Plan

      const result = priceForPlan(plan)

      expect(result).toEqual({
        cents: 7200,
        contract: false,
        metered: false,
        // 7200 / (24 * 30) = 10
        perHourCents: 10,
        perMonthCents: 7200,
        unit: 'month',
      })
    })

    it('preserves fractional perHourCents — does not round or floor', () => {
      const plan = {price: {cents: 500, contract: false, unit: 'month'}} as Plan

      const result = priceForPlan(plan)

      // 500 / 720 = 0.69444... — locked in so a future Math.floor/round
      // would fail the test.
      expect(result?.perHourCents).toBeCloseTo(500 / (24 * 30), 10)
      expect(result?.perHourCents).not.toBe(0)
    })

    it('breaks down an hourly plan into perMonth/perHour cents', () => {
      const plan = {price: {cents: 5, contract: false, unit: 'hour'}} as Plan

      const result = priceForPlan(plan)

      expect(result).toEqual({
        cents: 5,
        contract: false,
        metered: false,
        perHourCents: 5,
        // 5 * 24 * 30 = 3600
        perMonthCents: 3600,
        unit: 'hour',
      })
    })

    it('returns undefined when price is missing', () => {
      expect(priceForPlan({} as Plan)).toBeUndefined()
    })

    it('returns undefined when cents is not a number', () => {
      expect(priceForPlan({price: {unit: 'month'} as never} as Plan)).toBeUndefined()
    })

    it('returns undefined perMonthCents/perHourCents for unknown units', () => {
      const plan = {price: {cents: 1000, unit: 'token'}} as Plan

      const result = priceForPlan(plan)

      // The breakdown still exists (caller may want `cents` and
      // `unit`), but per-month and per-hour are undefined so the
      // caller can omit those labels.
      expect(result).toEqual({
        cents: 1000,
        contract: false,
        metered: false,
        perHourCents: undefined,
        perMonthCents: undefined,
        unit: 'token',
      })
    })

    it('reports contract=true when set', () => {
      const plan = {price: {cents: 0, contract: true, unit: 'month'}} as Plan

      expect(priceForPlan(plan)?.contract).toBe(true)
    })

    it('reports metered=true when set', () => {
      const plan = {
        price: {
          cents: 0, contract: false, metered: true, unit: 'month',
        },
      } as Plan

      expect(priceForPlan(plan)?.metered).toBe(true)
    })
  })

  describe('formatPlanPriceLabel', () => {
    it('formats a monthly plan as "$X / hour (Max $Y/month)"', () => {
      const plan = {price: {cents: 7200, contract: false, unit: 'month'}} as Plan

      expect(formatPlanPriceLabel(plan)).toBe('$0.10 / hour (Max $72.00/month)')
    })

    it('formats an hourly plan as "$X / hour (Max $Y/month)"', () => {
      const plan = {price: {cents: 5, contract: false, unit: 'hour'}} as Plan

      expect(formatPlanPriceLabel(plan)).toBe('$0.05 / hour (Max $36.00/month)')
    })

    it('returns an empty string for a metered plan', () => {
      const plan = {
        price: {
          cents: 1000, contract: false, metered: true, unit: 'month',
        },
      } as Plan

      expect(formatPlanPriceLabel(plan)).toBe('')
    })

    it('returns an empty string for a contract-priced plan', () => {
      const plan = {price: {cents: 0, contract: true, unit: 'month'}} as Plan

      expect(formatPlanPriceLabel(plan)).toBe('')
    })

    it('returns an empty string for an unknown unit', () => {
      const plan = {price: {cents: 1000, unit: 'token'}} as Plan

      expect(formatPlanPriceLabel(plan)).toBe('')
    })

    it('returns an empty string when the plan has no price', () => {
      expect(formatPlanPriceLabel({} as Plan)).toBe('')
    })

    it('honors locale and currency overrides', () => {
      const plan = {price: {cents: 7200, contract: false, unit: 'month'}} as Plan

      // de-DE uses '.' for thousands and ',' for decimals; EUR uses '€'.
      const result = formatPlanPriceLabel(plan, {currency: 'EUR', locale: 'de-DE'})

      // Don't pin the exact whitespace/ordering — different ICU
      // versions render currency differently — but assert the
      // structural pieces.
      expect(result).toMatch(/hour/)
      expect(result).toMatch(/Max/)
      expect(result).toMatch(/€|EUR/)
      expect(result).not.toMatch(/\$/)
    })
  })

  describe('describeAddon', () => {
    it('resolves the add-on globally when no app is given', async () => {
      const addon = buildAddon()
      const {ctx, listByAddOn, resolution} = buildCtx({
        attachments: [{id: 'att-1'} as AddOnAttachment],
        resolveResponses: [[addon]],
      })

      const result = await describeAddon(ctx, 'my-postgres')

      expect(resolution).toHaveBeenCalledExactlyOnceWith({addon: 'my-postgres'})
      expect(listByAddOn).toHaveBeenCalledWith(addon.id)
      expect(result.attachments).toEqual([{id: 'att-1'}])
    })

    it('requests 3.sdk + addon_service,plan expansion via withHeaders', async () => {
      const addon = buildAddon()
      const {ctx, withHeaders} = buildCtx({resolveResponses: [[addon]]})

      await describeAddon(ctx, 'my-postgres')

      expect(withHeaders).toHaveBeenCalledWith({
        Accept: 'application/vnd.heroku+json; version=3.sdk',
        'Accept-Expansion': 'addon_service,plan',
      })
    })

    it('resolves scoped to an app when one is provided', async () => {
      const addon = buildAddon()
      const {ctx, resolution} = buildCtx({resolveResponses: [[addon]]})

      await describeAddon(ctx, 'my-postgres', {appIdentity: 'my-app'})

      expect(resolution).toHaveBeenCalledExactlyOnceWith({addon: 'my-postgres', app: 'my-app'})
    })

    it('skips the app-scoped lookup for namespaced identities', async () => {
      const addon = buildAddon()
      const {ctx, resolution} = buildCtx({resolveResponses: [[addon]]})

      await describeAddon(ctx, 'postgres::sushi', {appIdentity: 'my-app'})

      expect(resolution).toHaveBeenCalledExactlyOnceWith({addon: 'postgres::sushi'})
    })

    it('falls back to a global resolve when the app-scoped lookup is 404 add_on', async () => {
      const addon = buildAddon()
      const {ctx, resolution} = buildCtx({
        resolveResponses: [buildNotFound('add_on'), [addon]],
      })

      const result = await describeAddon(ctx, 'my-postgres', {appIdentity: 'other-app'})

      expect(resolution).toHaveBeenNthCalledWith(1, {addon: 'my-postgres', app: 'other-app'})
      expect(resolution).toHaveBeenNthCalledWith(2, {addon: 'my-postgres'})
      expect(result.id).toBe(addon.id)
    })

    it('rethrows non-add_on 404s without falling back', async () => {
      const error = buildNotFound('app')
      const {ctx, resolution} = buildCtx({resolveResponses: [error]})

      await expect(describeAddon(ctx, 'my-postgres', {appIdentity: 'my-app'})).rejects.toBe(error)
      expect(resolution).toHaveBeenCalledTimes(1)
    })

    it('throws AddonNotFoundError when the resolver returns no matches', async () => {
      const {ctx} = buildCtx({resolveResponses: [[]]})

      await expect(describeAddon(ctx, 'nope')).rejects.toBeInstanceOf(AddonNotFoundError)
    })

    it('throws AddonAmbiguousError when the resolver returns more than one', async () => {
      const matches = [buildAddon({id: 'a1', name: 'one'}), buildAddon({id: 'a2', name: 'two'})]
      const {ctx} = buildCtx({resolveResponses: [matches]})

      await expect(describeAddon(ctx, 'ambig')).rejects.toBeInstanceOf(AddonAmbiguousError)
    })

    it('filters resolver matches by addonService when provided', async () => {
      /* eslint-disable camelcase */
      const matches = [
        buildAddon({addon_service: {name: 'heroku-redis'}, id: 'a1', name: 'redis-app'}),
        buildAddon({addon_service: {name: 'heroku-postgresql'}, id: 'a2', name: 'pg-app'}),
      ]
      /* eslint-enable camelcase */
      const {ctx, resolution} = buildCtx({resolveResponses: [matches]})

      const result = await describeAddon(ctx, 'shared-name', {addonService: 'heroku-postgresql'})

      // The platform's filter would exclude alpha add-ons, so we filter client-side.
      expect(resolution).toHaveBeenCalledExactlyOnceWith({addon: 'shared-name'})
      expect(result.id).toBe('a2')
    })

    it('throws AddonNotFoundError when addonService filter eliminates all matches', async () => {
      // eslint-disable-next-line camelcase
      const matches = [buildAddon({addon_service: {name: 'heroku-redis'}, id: 'a1'})]
      const {ctx} = buildCtx({resolveResponses: [matches]})

      await expect(describeAddon(ctx, 'shared-name', {addonService: 'heroku-postgresql'})).rejects.toBeInstanceOf(AddonNotFoundError)
    })

    it('replaces plan.price with grandfathered cents/contract from billed_price', async () => {
      const addon = buildAddon({
        // eslint-disable-next-line camelcase
        billed_price: {cents: 0, contract: true},
        plan: {id: 'plan-id', name: 'heroku-postgresql:standard-0', price: {cents: 5000, unit: 'month'}},
      })
      const {ctx} = buildCtx({resolveResponses: [[addon]]})

      const result = await describeAddon(ctx, 'my-postgres')

      expect(result.plan).toMatchObject({
        name: 'heroku-postgresql:standard-0',
        price: {cents: 0, contract: true, unit: 'month'},
      })
    })

    it('preserves the original plan.price when billed_price is missing', async () => {
      const addon = buildAddon({
        // eslint-disable-next-line camelcase
        billed_price: undefined,
        plan: {id: 'plan-id', name: 'heroku-postgresql:standard-0', price: {cents: 5000, contract: false, unit: 'month'}},
      })
      const {ctx} = buildCtx({resolveResponses: [[addon]]})

      const result = await describeAddon(ctx, 'my-postgres')

      // Without billed_price, the original cents/contract must survive — the
      // previous implementation overwrote both with `undefined`.
      expect(result.plan).toMatchObject({
        name: 'heroku-postgresql:standard-0',
        price: {cents: 5000, contract: false, unit: 'month'},
      })
    })

    it('returns a price object even when neither plan.price nor billed_price exist', async () => {
      const addon = buildAddon({
        // eslint-disable-next-line camelcase
        billed_price: undefined,
        plan: {id: 'plan-id', name: 'heroku-postgresql:standard-0'},
      })
      const {ctx} = buildCtx({resolveResponses: [[addon]]})

      const result = await describeAddon(ctx, 'my-postgres')

      expect(result.plan).toMatchObject({name: 'heroku-postgresql:standard-0', price: {}})
    })

    it('does not mutate the resolved add-on', async () => {
      const addon = buildAddon({
        // eslint-disable-next-line camelcase
        billed_price: {cents: 0, contract: true},
        plan: {id: 'plan-id', name: 'heroku-postgresql:standard-0', price: {cents: 5000, unit: 'month'}},
      })
      const originalPriceCents = (addon.plan as {price: {cents: number}}).price.cents
      const {ctx} = buildCtx({resolveResponses: [[addon]]})

      const result = await describeAddon(ctx, 'my-postgres')

      // The returned object reflects grandfathered pricing.
      expect((result.plan as {price: {cents: number}}).price.cents).toBe(0)
      // The input add-on is untouched.
      expect((addon.plan as {price: {cents: number}}).price.cents).toBe(originalPriceCents)
      // 'attachments' is not added to the input either.
      expect((addon as Partial<{attachments: unknown}>).attachments).toBeUndefined()
    })

    it('throws if the resolver returns an add-on missing required ids', async () => {
      const broken = {id: 'addon-id', name: 'broken'} as AddOn // no app
      const {ctx} = buildCtx({resolveResponses: [[broken]]})

      await expect(describeAddon(ctx, 'broken')).rejects.toThrow(/missing required fields/)
    })

    it('throws if the signal is already aborted', async () => {
      const {ctx, resolution} = buildCtx()
      const controller = new AbortController()
      controller.abort()

      await expect(describeAddon(ctx, 'my-postgres', {signal: controller.signal})).rejects.toThrow()
      expect(resolution).not.toHaveBeenCalled()
    })
  })

  describe('resolveAddon', () => {
    it('returns the resolved add-on directly', async () => {
      const addon = buildAddon()
      const {ctx, resolution} = buildCtx({resolveResponses: [[addon]]})

      const result = await resolveAddon(ctx, 'my-postgres', {appIdentity: 'my-app'})

      expect(resolution).toHaveBeenCalledExactlyOnceWith({addon: 'my-postgres', app: 'my-app'})
      expect(result.id).toBe('addon-id')
    })

    it('throws if the signal is already aborted', async () => {
      const {ctx, resolution} = buildCtx()
      const controller = new AbortController()
      controller.abort()

      await expect(resolveAddon(ctx, 'my-postgres', {signal: controller.signal})).rejects.toThrow()
      expect(resolution).not.toHaveBeenCalled()
    })
  })

  describe('resolveAddonByAttachment', () => {
    it('resolves and returns the add-on from the matched attachment', async () => {
      const {ctx, resolutionByAttachment} = buildCtx({
        resolveByAttachmentResponses: [
          {addon: {app: {id: 'app-uuid', name: 'my-app'}, id: 'addon-id', name: 'postgres-addon'}} as AddOnAttachment,
        ],
      })

      const result = await resolveAddonByAttachment(ctx, 'my-app', 'DATABASE_URL')

      expect(resolutionByAttachment).toHaveBeenCalledWith({
        // eslint-disable-next-line camelcase
        addon_attachment: 'DATABASE_URL',
        app: 'my-app',
      })
      expect(result.id).toBe('addon-id')
      expect(result.app.id).toBe('app-uuid')
    })

    it('throws AddonNotFoundError when no attachment matches', async () => {
      const {ctx} = buildCtx({resolveByAttachmentResponses: []})

      await expect(resolveAddonByAttachment(ctx, 'my-app', 'NONEXISTENT')).rejects.toBeInstanceOf(AddonNotFoundError)
    })

    it('throws AddonNotFoundError when the matched attachment lacks an addon id', async () => {
      const {ctx} = buildCtx({
        resolveByAttachmentResponses: [
          {addon: {app: {name: 'my-app'}, name: 'incomplete'}} as AddOnAttachment,
        ],
      })

      await expect(resolveAddonByAttachment(ctx, 'my-app', 'DATABASE_URL')).rejects.toBeInstanceOf(AddonNotFoundError)
    })

    it('throws if the signal is already aborted', async () => {
      const {ctx, resolutionByAttachment} = buildCtx()
      const controller = new AbortController()
      controller.abort()

      await expect(resolveAddonByAttachment(ctx, 'my-app', 'DATABASE_URL', {signal: controller.signal})).rejects.toThrow()
      expect(resolutionByAttachment).not.toHaveBeenCalled()
    })
  })

  describe('resolveAttachment', () => {
    it('returns the full attachment including web_url', async () => {
      const {ctx, resolutionByAttachment} = buildCtx({
        resolveByAttachmentResponses: [
          {addon: {app: {id: 'app-uuid', name: 'my-app'}, id: 'addon-id', name: 'postgres-addon'}, web_url: 'https://addons-sso.heroku.com/apps/my-app/addons/addon-id'} as AddOnAttachment,
        ],
      })

      const result = await resolveAttachment(ctx, 'my-app', 'DATABASE_URL')

      expect(resolutionByAttachment).toHaveBeenCalledWith({
        // eslint-disable-next-line camelcase
        addon_attachment: 'DATABASE_URL',
        app: 'my-app',
      })
      expect(result.web_url).toBe('https://addons-sso.heroku.com/apps/my-app/addons/addon-id')
      expect(result.addon.id).toBe('addon-id')
      expect(result.addon.app.id).toBe('app-uuid')
    })

    it('throws AddonNotFoundError when no attachment matches', async () => {
      const {ctx} = buildCtx({resolveByAttachmentResponses: []})

      await expect(resolveAttachment(ctx, 'my-app', 'NONEXISTENT')).rejects.toBeInstanceOf(AddonNotFoundError)
    })

    it('throws AddonNotFoundError when the matched attachment lacks an addon id', async () => {
      const {ctx} = buildCtx({
        resolveByAttachmentResponses: [
          {addon: {app: {name: 'my-app'}, name: 'incomplete'}} as AddOnAttachment,
        ],
      })

      await expect(resolveAttachment(ctx, 'my-app', 'DATABASE_URL')).rejects.toBeInstanceOf(AddonNotFoundError)
    })

    it('throws AddonNotFoundError when the matched attachment\'s addon lacks app.id', async () => {
      const {ctx} = buildCtx({
        resolveByAttachmentResponses: [
          {addon: {app: {name: 'my-app'}, id: 'addon-id', name: 'x'}} as AddOnAttachment,
        ],
      })

      await expect(resolveAttachment(ctx, 'my-app', 'DATABASE_URL')).rejects.toBeInstanceOf(AddonNotFoundError)
    })

    it('throws if the signal is already aborted', async () => {
      const {ctx, resolutionByAttachment} = buildCtx()
      const controller = new AbortController()
      controller.abort()

      await expect(resolveAttachment(ctx, 'my-app', 'DATABASE_URL', {signal: controller.signal})).rejects.toThrow()
      expect(resolutionByAttachment).not.toHaveBeenCalled()
    })
  })

  describe('createAndWait', () => {
    it('returns the created add-on when wait is not requested', async () => {
      const created = buildAddon({state: 'provisioning'} as Partial<AddOn>)
      const {create, ctx, infoByApp} = buildCreateCtx({createResponses: [created]})

      const result = await createAndWait(ctx, 'my-app', {plan: 'heroku-redis:hobby'})

      expect(create).toHaveBeenCalledExactlyOnceWith('my-app', {plan: 'heroku-redis:hobby'})
      expect(infoByApp).not.toHaveBeenCalled()
      expect(result).toBe(created)
    })

    it('returns immediately when the create response is already terminal', async () => {
      const created = buildAddon({state: 'provisioned'} as Partial<AddOn>)
      const {ctx, infoByApp} = buildCreateCtx({createResponses: [created]})

      const result = await createAndWait(ctx, 'my-app', {plan: 'heroku-redis:hobby'}, {wait: true})

      expect(infoByApp).not.toHaveBeenCalled()
      expect(result).toBe(created)
    })

    it('polls infoByApp until the add-on leaves provisioning', async () => {
      const provisioning = buildAddon({state: 'provisioning'} as Partial<AddOn>)
      const provisioned = buildAddon({state: 'provisioned'} as Partial<AddOn>)
      const {ctx, infoByApp, withHeaders} = buildCreateCtx({
        createResponses: [provisioning],
        infoByAppResponses: [provisioning, provisioned],
      })

      const result = await createAndWait(
        ctx,
        'my-app',
        {plan: 'heroku-redis:hobby'},
        {wait: true, waitIntervalMs: 1},
      )

      expect(withHeaders).toHaveBeenCalledWith({'Accept-Expansion': 'addon_service,plan'})
      expect(withHeaders).toHaveBeenCalledWith({'X-Heroku-Legacy-Provider-Messages': 'true'})
      expect(infoByApp).toHaveBeenCalledTimes(2)
      expect(infoByApp).toHaveBeenLastCalledWith('my-app', provisioning.name)
      expect(result).toBe(provisioned)
    })

    it('fires onProvisioning once after the create response, before polling', async () => {
      const provisioning = buildAddon({state: 'provisioning'} as Partial<AddOn>)
      const provisioned = buildAddon({state: 'provisioned'} as Partial<AddOn>)
      const calls: string[] = []
      const onProvisioning = vi.fn(addon => {
        calls.push(`onProvisioning:${addon.id}`)
      })
      const {ctx} = buildCreateCtx({
        createResponses: [provisioning],
        infoByAppResponses: [provisioned],
      })

      await createAndWait(
        ctx,
        'my-app',
        {plan: 'heroku-redis:hobby'},
        {onProvisioning, wait: true, waitIntervalMs: 1},
      )

      expect(onProvisioning).toHaveBeenCalledExactlyOnceWith(provisioning)
      expect(calls).toEqual([`onProvisioning:${provisioning.id}`])
    })

    it('does not fire onProvisioning when the create response is already terminal', async () => {
      const provisioned = buildAddon({state: 'provisioned'} as Partial<AddOn>)
      const onProvisioning = vi.fn()
      const {ctx} = buildCreateCtx({createResponses: [provisioned]})

      await createAndWait(
        ctx,
        'my-app',
        {plan: 'heroku-redis:hobby'},
        {onProvisioning, wait: true},
      )

      expect(onProvisioning).not.toHaveBeenCalled()
    })

    it('throws AddonProvisioningFailedError when the wait terminates in deprovisioned', async () => {
      const provisioning = buildAddon({state: 'provisioning'} as Partial<AddOn>)
      const failed = buildAddon({state: 'deprovisioned'} as Partial<AddOn>)
      const {ctx} = buildCreateCtx({
        createResponses: [provisioning],
        infoByAppResponses: [failed],
      })

      await expect(createAndWait(
        ctx,
        'my-app',
        {plan: 'heroku-redis:hobby'},
        {wait: true, waitIntervalMs: 1},
      )).rejects.toBeInstanceOf(AddonProvisioningFailedError)
    })

    it('throws AddonProvisioningFailedError when create itself returns deprovisioned', async () => {
      const failed = buildAddon({state: 'deprovisioned'} as Partial<AddOn>)
      const {ctx} = buildCreateCtx({createResponses: [failed]})

      await expect(createAndWait(ctx, 'my-app', {plan: 'heroku-redis:hobby'}))
        .rejects.toBeInstanceOf(AddonProvisioningFailedError)
    })

    it('converts a 423 confirmation_required platform error into AddonConfirmationRequiredError', async () => {
      const platformError = new HerokuApiError(
        'Please confirm by typing the application name.',
        423,
        new Response(),
        {id: 'confirmation_required', message: 'Please confirm by typing the application name.'},
      )
      const {ctx} = buildCreateCtx({createResponses: [platformError]})

      const error = await createAndWait(ctx, 'my-app', {plan: 'heroku-redis:hobby'}).catch(error_ => error_)
      expect(error).toBeInstanceOf(AddonConfirmationRequiredError)
      expect((error as AddonConfirmationRequiredError).platformMessage).toBe('Please confirm by typing the application name.')
    })

    it('rethrows non-confirmation errors unchanged', async () => {
      const error = new Error('boom')
      const {ctx} = buildCreateCtx({createResponses: [error]})

      await expect(createAndWait(ctx, 'my-app', {plan: 'heroku-redis:hobby'})).rejects.toBe(error)
    })

    it('throws if the abort signal is already aborted', async () => {
      const {create, ctx} = buildCreateCtx({createResponses: [buildAddon()]})
      const controller = new AbortController()
      controller.abort()

      await expect(createAndWait(
        ctx,
        'my-app',
        {plan: 'heroku-redis:hobby'},
        {signal: controller.signal},
      )).rejects.toThrow()
      expect(create).not.toHaveBeenCalled()
    })
  })

  describe('destroyAndWait', () => {
    afterEach(() => {
      vi.restoreAllMocks()
    })

    it('issues DELETE with Accept-Expansion: plan and returns the response body', async () => {
      const deleted = buildAddon({state: 'deprovisioned'} as Partial<AddOn>)
      const {addOnDelete, ctx, withHeaders} = buildDestroyCtx()
      addOnDelete.mockResolvedValue(deleted)

      const result = await destroyAndWait(ctx, 'my-app', 'my-postgres')

      expect(addOnDelete).toHaveBeenCalledExactlyOnceWith('my-app', 'my-postgres')
      expect(withHeaders).toHaveBeenCalledWith({'Accept-Expansion': 'plan'})
      expect(result.state).toBe('deprovisioned')
    })

    it('returns immediately without polling when wait is not requested', async () => {
      const deprovisioning = buildAddon({state: 'provisioning'} as Partial<AddOn>)
      const {addOnDelete, ctx, infoByApp} = buildDestroyCtx()
      addOnDelete.mockResolvedValue(deprovisioning)

      await destroyAndWait(ctx, 'my-app', 'my-postgres')

      expect(infoByApp).not.toHaveBeenCalled()
    })

    it('polls infoByApp until the add-on leaves deprovisioning', async () => {
      const deprovisioning = {...buildAddon(), state: 'deprovisioning'} as unknown as AddOn
      const deprovisioned = buildAddon({state: 'deprovisioned'} as Partial<AddOn>)
      const {addOnDelete, ctx, infoByApp} = buildDestroyCtx({
        infoByAppResponses: [deprovisioning, deprovisioned],
      })
      addOnDelete.mockResolvedValue(deprovisioning)

      const result = await destroyAndWait(ctx, 'my-app', 'my-postgres', {wait: true, waitIntervalMs: 1})

      expect(infoByApp).toHaveBeenCalledTimes(2)
      expect(result.state).toBe('deprovisioned')
    })

    it('treats a 404 during polling as successful deprovisioning', async () => {
      const deprovisioning = {...buildAddon(), state: 'deprovisioning'} as unknown as AddOn
      const notFound = Object.assign(new Error('not found'), {statusCode: 404})
      const {addOnDelete, ctx, infoByApp} = buildDestroyCtx({
        infoByAppResponses: [notFound],
      })
      addOnDelete.mockResolvedValue(deprovisioning)

      const result = await destroyAndWait(ctx, 'my-app', 'my-postgres', {wait: true, waitIntervalMs: 1})

      expect(infoByApp).toHaveBeenCalledTimes(1)
      expect(result.state).toBe('deprovisioned')
    })

    it('fires onDeprovisioning once after delete, before polling', async () => {
      const deprovisioning = {...buildAddon(), state: 'deprovisioning'} as unknown as AddOn
      const deprovisioned = buildAddon({state: 'deprovisioned'} as Partial<AddOn>)
      const calls: string[] = []
      const onDeprovisioning = vi.fn(() => {
        calls.push('onDeprovisioning')
      })
      const {addOnDelete, ctx, infoByApp} = buildDestroyCtx()
      addOnDelete.mockResolvedValue(deprovisioning)
      infoByApp.mockImplementation(async () => {
        calls.push('poll')
        return deprovisioned
      })

      await destroyAndWait(ctx, 'my-app', 'my-postgres', {onDeprovisioning, wait: true, waitIntervalMs: 1})

      expect(calls).toEqual(['onDeprovisioning', 'poll'])
    })

    it('does not fire onDeprovisioning when the delete response is already terminal', async () => {
      const deprovisioned = buildAddon({state: 'deprovisioned'} as Partial<AddOn>)
      const onDeprovisioning = vi.fn()
      const {addOnDelete, ctx} = buildDestroyCtx()
      addOnDelete.mockResolvedValue(deprovisioned)

      await destroyAndWait(ctx, 'my-app', 'my-postgres', {onDeprovisioning, wait: true})

      expect(onDeprovisioning).not.toHaveBeenCalled()
    })

    it('rethrows non-404 errors from infoByApp during polling', async () => {
      const deprovisioning = {...buildAddon(), state: 'deprovisioning'} as unknown as AddOn
      const boom = new Error('network error')
      const {addOnDelete, ctx} = buildDestroyCtx({infoByAppResponses: [boom]})
      addOnDelete.mockResolvedValue(deprovisioning)

      await expect(destroyAndWait(ctx, 'my-app', 'my-postgres', {wait: true, waitIntervalMs: 1})).rejects.toBe(boom)
    })

    it('sets Accept-Expansion: plan on poll requests via withHeaders', async () => {
      const deprovisioning = {...buildAddon(), state: 'deprovisioning'} as unknown as AddOn
      const deprovisioned = buildAddon({state: 'deprovisioned'} as Partial<AddOn>)
      const {addOnDelete, ctx, withHeaders} = buildDestroyCtx({infoByAppResponses: [deprovisioned]})
      addOnDelete.mockResolvedValue(deprovisioning)

      await destroyAndWait(ctx, 'my-app', 'my-postgres', {wait: true, waitIntervalMs: 1})

      expect(withHeaders).toHaveBeenCalledWith({'Accept-Expansion': 'plan'})
    })

    it('returns an empty object without polling when the delete response is empty (204)', async () => {
      const {addOnDelete, ctx, infoByApp} = buildDestroyCtx()
      addOnDelete.mockResolvedValue()

      const result = await destroyAndWait(ctx, 'my-app', 'my-postgres')

      expect(result).toEqual({})
      expect(infoByApp).not.toHaveBeenCalled()
    })

    it('sends force in the delete body when force is true', async () => {
      const deprovisioned = buildAddon({state: 'deprovisioned'} as Partial<AddOn>)
      const {addOnDelete, ctx, withOptions} = buildDestroyCtx()
      addOnDelete.mockResolvedValue(deprovisioned)

      await destroyAndWait(ctx, 'my-app', 'my-postgres', {force: true})

      expect(withOptions).toHaveBeenCalledWith(expect.objectContaining({body: {force: true}}))
      expect(addOnDelete).toHaveBeenCalledWith('my-app', 'my-postgres')
    })

    it('does not send a body when force is not set', async () => {
      const deprovisioned = buildAddon({state: 'deprovisioned'} as Partial<AddOn>)
      const {addOnDelete, ctx, withOptions} = buildDestroyCtx()
      addOnDelete.mockResolvedValue(deprovisioned)

      await destroyAndWait(ctx, 'my-app', 'my-postgres')

      // No withOptions call should carry a body when force is absent.
      expect(withOptions.mock.calls.every(([opts]) => !('body' in (opts ?? {})))).toBe(true)
    })

    it('does not carry the force body on poll requests', async () => {
      const deprovisioning = {...buildAddon(), state: 'deprovisioning'} as unknown as AddOn
      const deprovisioned = buildAddon({state: 'deprovisioned'} as Partial<AddOn>)
      const {addOnDelete, ctx, withOptions} = buildDestroyCtx({infoByAppResponses: [deprovisioned]})
      addOnDelete.mockResolvedValue(deprovisioning)

      await destroyAndWait(ctx, 'my-app', 'my-postgres', {force: true, wait: true, waitIntervalMs: 1})

      // The force body must scope to the delete client only, never the GET
      // poll client. The poll client is derived from the base
      // `withOptions({headers, signal})` call (no body); the delete client is
      // a SEPARATE `withOptions({body: {force: true}})` call. Assert both
      // exist so a regression that folds force into the shared poll setup —
      // leaking the body onto every poll request — fails here.
      expect(withOptions).toHaveBeenCalledWith(expect.objectContaining({body: {force: true}}))
      expect(withOptions.mock.calls.some(([opts]) => !('body' in (opts ?? {})))).toBe(true)
    })

    it('throws if the abort signal is already aborted', async () => {
      const controller = new AbortController()
      controller.abort()
      const {addOnDelete, ctx} = buildDestroyCtx()

      await expect(destroyAndWait(ctx, 'my-app', 'my-postgres', {signal: controller.signal})).rejects.toThrow()
      expect(addOnDelete).not.toHaveBeenCalled()
    })
  })

  describe('waitForProvisioning', () => {
    it('returns immediately when the addon is already provisioned', async () => {
      const provisioned = buildAddon({state: 'provisioned'} as Partial<AddOn>)
      const {ctx, infoByApp} = buildWaitCtx()

      const result = await waitForProvisioning(ctx, provisioned)

      expect(infoByApp).not.toHaveBeenCalled()
      expect(result).toBe(provisioned)
    })

    it('polls infoByApp until provisioned when appIdentity is provided', async () => {
      const provisioning = buildAddon({state: 'provisioning'} as Partial<AddOn>)
      const provisioned = buildAddon({state: 'provisioned'} as Partial<AddOn>)
      const {ctx, infoByApp} = buildWaitCtx({
        infoByAppResponses: [provisioning, provisioned],
      })

      const result = await waitForProvisioning(ctx, provisioning, {appIdentity: 'my-app', waitIntervalMs: 1})

      expect(infoByApp).toHaveBeenCalledTimes(2)
      expect(infoByApp).toHaveBeenCalledWith('my-app', provisioning.name)
      expect(result.state).toBe('provisioned')
    })

    it('polls info (global) when no appIdentity is provided', async () => {
      const provisioning = buildAddon({state: 'provisioning'} as Partial<AddOn>)
      const provisioned = buildAddon({state: 'provisioned'} as Partial<AddOn>)
      const {ctx, info, infoByApp} = buildWaitCtx({
        infoResponses: [provisioned],
      })

      await waitForProvisioning(ctx, provisioning, {waitIntervalMs: 1})

      expect(info).toHaveBeenCalledExactlyOnceWith(provisioning.name)
      expect(infoByApp).not.toHaveBeenCalled()
    })

    it('throws AddonProvisioningFailedError when terminal state is deprovisioned', async () => {
      const provisioning = buildAddon({state: 'provisioning'} as Partial<AddOn>)
      const failed = buildAddon({state: 'deprovisioned'} as Partial<AddOn>)
      const {ctx} = buildWaitCtx({infoByAppResponses: [failed]})

      await expect(waitForProvisioning(ctx, provisioning, {appIdentity: 'my-app', waitIntervalMs: 1})).rejects.toBeInstanceOf(AddonProvisioningFailedError)
    })

    it('polls through deprovisioning until deprovisioned', async () => {
      const deprovisioning = {...buildAddon(), state: 'deprovisioning'} as unknown as AddOn
      const deprovisioned = buildAddon({state: 'deprovisioned'} as Partial<AddOn>)
      const {ctx, infoByApp} = buildWaitCtx({
        infoByAppResponses: [deprovisioning as AddOn, deprovisioned],
      })

      await expect(waitForProvisioning(ctx, deprovisioning as AddOn, {appIdentity: 'my-app', waitIntervalMs: 1})).rejects.toBeInstanceOf(AddonProvisioningFailedError)

      expect(infoByApp).toHaveBeenCalledTimes(2)
    })

    it('sets Accept-Expansion: addon_service,plan on poll requests via withHeaders', async () => {
      const provisioning = buildAddon({state: 'provisioning'} as Partial<AddOn>)
      const provisioned = buildAddon({state: 'provisioned'} as Partial<AddOn>)
      const {ctx, withHeaders} = buildWaitCtx({infoByAppResponses: [provisioned]})

      await waitForProvisioning(ctx, provisioning, {appIdentity: 'my-app', waitIntervalMs: 1})

      expect(withHeaders).toHaveBeenCalledWith({'Accept-Expansion': 'addon_service,plan'})
    })

    it('throws if the abort signal is already aborted', async () => {
      const provisioning = buildAddon({state: 'provisioning'} as Partial<AddOn>)
      const controller = new AbortController()
      controller.abort()
      const {ctx, infoByApp} = buildWaitCtx()

      await expect(waitForProvisioning(ctx, provisioning, {signal: controller.signal})).rejects.toThrow()
      expect(infoByApp).not.toHaveBeenCalled()
    })
  })

  describe('addOnExtensions', () => {
    it('declares service: platform, resource: addOn', () => {
      expect(addOnExtensions.service).toBe('platform')
      expect(addOnExtensions.resource).toBe('addOn')
    })

    it('factory exposes the full add-on surface', () => {
      const {ctx} = buildCtx()
      const methods = addOnExtensions.factory(ctx)
      expect(typeof methods.createAndWait).toBe('function')
      expect(typeof methods.describe).toBe('function')
      expect(typeof methods.destroyAndWait).toBe('function')
      expect(typeof methods.formatPlanPriceLabel).toBe('function')
      expect(typeof methods.listPlans).toBe('function')
      expect(typeof methods.listPlansForAddon).toBe('function')
      expect(typeof methods.priceForPlan).toBe('function')
      expect(typeof methods.resolve).toBe('function')
      expect(typeof methods.resolveByAttachment).toBe('function')
      expect(typeof methods.resolveAttachment).toBe('function')
      expect(typeof methods.upgrade).toBe('function')
      expect(typeof methods.waitForProvisioning).toBe('function')
    })

    it('upgrade delegates to the named function', async () => {
      const resolved = buildAddon({app: {id: 'app-1', name: 'my-app'}, id: 'addon-1'})
      const {ctx, update} = buildCtx({
        resolveResponses: [[resolved]],
        updateResponse: resolved,
      })
      const methods = addOnExtensions.factory(ctx)

      await methods.upgrade('addon-1', 'service:plan-1')

      expect(update).toHaveBeenCalledWith('app-1', 'addon-1', {plan: 'service:plan-1'})
    })
  })
})
