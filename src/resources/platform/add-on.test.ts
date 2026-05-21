import type {AddOn, AddOnAttachment, Plan} from '@heroku/types/3.sdk'

import {HerokuApiError, NotFoundError} from '@heroku/heroku-fetch'
import {
  afterEach, describe, expect, it, vi,
} from 'vitest'

import type {ResourceCtx} from '../../core/extend-resource.js'

import {
  AddonAmbiguousError,
  AddonConfirmationRequiredError,
  addOnExtensions,
  AddonNotFoundError,
  AddonProvisioningFailedError,
  createAndWait,
  describeAddon,
  listPlans,
  resolveAddon,
  resolveAddonByAttachment,
  upgrade,
} from './add-on.js'

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
      expect(infoByApp).toHaveBeenCalledTimes(2)
      expect(infoByApp).toHaveBeenLastCalledWith('my-app', provisioning.name)
      expect(result).toBe(provisioned)
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

  describe('addOnExtensions', () => {
    it('declares service: platform, resource: addOn', () => {
      expect(addOnExtensions.service).toBe('platform')
      expect(addOnExtensions.resource).toBe('addOn')
    })

    it('factory exposes createAndWait, describe, listPlans, resolve, resolveByAttachment, upgrade', () => {
      const {ctx} = buildCtx()
      const methods = addOnExtensions.factory(ctx)
      expect(typeof methods.createAndWait).toBe('function')
      expect(typeof methods.describe).toBe('function')
      expect(typeof methods.listPlans).toBe('function')
      expect(typeof methods.resolve).toBe('function')
      expect(typeof methods.resolveByAttachment).toBe('function')
      expect(typeof methods.upgrade).toBe('function')
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
