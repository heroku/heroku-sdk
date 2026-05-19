import type { AddOn, AddOnAttachment, Plan } from '@heroku/types/3.sdk'

import { NotFoundError } from '@heroku/api-client'
import {
  afterEach, describe, expect, it, vi,
} from 'vitest'

import { createPlatformClient } from '../services/platform.js'
import {
  AddonAmbiguousError, AddonNotFoundError, describeAddon, listPlans,
  resolveAddon, resolveAddonByAttachment, upgrade,
} from './add-on.js'

vi.mock('../services/platform.js', () => ({
  createPlatformClient: vi.fn(),
}))

function buildAddon(overrides: Partial<AddOn> = {}): AddOn {
  return {
    app: { id: 'app-id', name: 'my-app' },
    // eslint-disable-next-line camelcase
    billed_price: { cents: 5000, contract: false },
    id: 'addon-id',
    name: 'my-postgres',
    plan: { id: 'plan-id', name: 'heroku-postgresql:standard-0', price: { cents: 5000, unit: 'month' } },
    ...overrides,
  } as AddOn
}

function buildAddOnClient({
  attachments = [],
  resolveResponses,
  updateResponse,
}: {
  attachments?: AddOnAttachment[]
  resolveResponses: Array<AddOn[] | Error>
  updateResponse?: AddOn
}) {
  const resolution = vi.fn()
  for (const response of resolveResponses) {
    if (response instanceof Error) {
      resolution.mockRejectedValueOnce(response)
    } else {
      resolution.mockResolvedValueOnce(response)
    }
  }

  const listByAddOn = vi.fn().mockResolvedValue(attachments)
  const update = vi.fn().mockResolvedValue(updateResponse ?? {})

  const client = {
    addOn: { resolution, update },
    addOnAttachment: { listByAddOn },
  }
  vi.mocked(createPlatformClient).mockReturnValue(client as never)

  return { listByAddOn, resolution, update }
}

function buildNotFound(resource = 'add_on'): NotFoundError {
  const response = new Response(JSON.stringify({ id: 'not_found', resource }), {
    headers: { 'content-type': 'application/json' },
    status: 404,
  })
  return new NotFoundError(response, { id: 'not_found' })
}

describe('add-on compositions', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('upgrade', () => {
    it('resolves the addon then calls addOn.update with the plan', async () => {
      const resolved = buildAddon({ app: { id: 'app-1', name: 'my-app' }, id: 'addon-1', name: 'kafka-swiftly-123' })
      const updated = buildAddon({ id: 'addon-1', name: 'kafka-swiftly-123' })
      const { resolution, update } = buildAddOnClient({
        resolveResponses: [[resolved]],
        updateResponse: updated,
      })

      const result = await upgrade('kafka-swiftly-123', 'heroku-kafka:hobby', { appIdentity: 'my-app' })

      expect(resolution).toHaveBeenCalledExactlyOnceWith({ addon: 'kafka-swiftly-123', app: 'my-app' })
      expect(update).toHaveBeenCalledExactlyOnceWith('app-1', 'addon-1', { plan: 'heroku-kafka:hobby' })
      expect(result).toBe(updated)
    })

    it('resolves globally when no appIdentity is provided', async () => {
      const resolved = buildAddon({ app: { id: 'app-1', name: 'my-app' }, id: 'addon-1' })
      const { resolution, update } = buildAddOnClient({
        resolveResponses: [[resolved]],
        updateResponse: resolved,
      })

      await upgrade('postgres::sushi', 'heroku-postgresql:premium-0')

      expect(resolution).toHaveBeenCalledExactlyOnceWith({ addon: 'postgres::sushi' })
      expect(update).toHaveBeenCalledWith('app-1', 'addon-1', { plan: 'heroku-postgresql:premium-0' })
    })

    it('forwards clientOptions to createPlatformClient', async () => {
      buildAddOnClient({
        resolveResponses: [[buildAddon({ app: { id: 'app-1' }, id: 'addon-1' })]],
        updateResponse: buildAddon(),
      })

      await upgrade('addon-1', 'plan-1', { clientOptions: { token: 'test-token' } })

      expect(createPlatformClient).toHaveBeenCalledWith({ token: 'test-token' })
    })

    it('throws if the signal is already aborted', async () => {
      const controller = new AbortController()
      controller.abort()

      await expect(upgrade('addon-1', 'plan-1', { signal: controller.signal })).rejects.toThrow()
      expect(createPlatformClient).not.toHaveBeenCalled()
    })
  })

  describe('listPlans', () => {
    it('returns plans sorted ascending by price.cents', async () => {
      const plans = [
        { id: 'p3', name: 'premium-0', price: { cents: 5000, unit: 'month' } },
        { id: 'p1', name: 'free', price: { cents: 0, unit: 'month' } },
        { id: 'p2', name: 'hobby', price: { cents: 700, unit: 'month' } },
      ] as Plan[]
      const listByAddOn = vi.fn().mockResolvedValue(plans)
      vi.mocked(createPlatformClient).mockReturnValue({ plan: { listByAddOn } } as never)

      const result = await listPlans('heroku-postgresql')

      expect(listByAddOn).toHaveBeenCalledWith('heroku-postgresql')
      expect(result.map(plan => plan.id)).toEqual(['p1', 'p2', 'p3'])
    })

    it('places plans without a price after priced plans', async () => {
      const plans = [
        { id: 'p3', name: 'premium-0', price: { cents: 5000 } },
        { id: 'p4', name: 'metered', price: { metered: true } },
        { id: 'p1', name: 'free', price: { cents: 0 } },
      ] as Plan[]
      const listByAddOn = vi.fn().mockResolvedValue(plans)
      vi.mocked(createPlatformClient).mockReturnValue({ plan: { listByAddOn } } as never)

      const result = await listPlans('heroku-redis')

      expect(result.map(plan => plan.id)).toEqual(['p1', 'p3', 'p4'])
    })

    it('does not mutate the input list', async () => {
      const plans = [
        { id: 'p2', name: 'b', price: { cents: 100 } },
        { id: 'p1', name: 'a', price: { cents: 0 } },
      ] as Plan[]
      const original = [...plans]
      const listByAddOn = vi.fn().mockResolvedValue(plans)
      vi.mocked(createPlatformClient).mockReturnValue({ plan: { listByAddOn } } as never)

      await listPlans('svc')

      expect(plans).toEqual(original)
    })

    it('throws if the signal is already aborted', async () => {
      const controller = new AbortController()
      controller.abort()

      await expect(listPlans('svc', { signal: controller.signal })).rejects.toThrow()
      expect(createPlatformClient).not.toHaveBeenCalled()
    })
  })

  describe('describeAddon', () => {
    it('resolves the add-on globally when no app is given', async () => {
      const addon = buildAddon()
      const { listByAddOn, resolution } = buildAddOnClient({
        attachments: [{ id: 'att-1' } as AddOnAttachment],
        resolveResponses: [[addon]],
      })

      const result = await describeAddon('my-postgres')

      expect(resolution).toHaveBeenCalledExactlyOnceWith({ addon: 'my-postgres' })
      expect(listByAddOn).toHaveBeenCalledWith(addon.id)
      expect(result.attachments).toEqual([{ id: 'att-1' }])
    })

    it('resolves scoped to an app when one is provided', async () => {
      const addon = buildAddon()
      const { resolution } = buildAddOnClient({ resolveResponses: [[addon]] })

      await describeAddon('my-postgres', { appIdentity: 'my-app' })

      expect(resolution).toHaveBeenCalledExactlyOnceWith({ addon: 'my-postgres', app: 'my-app' })
    })

    it('skips the app-scoped lookup for namespaced identities', async () => {
      const addon = buildAddon()
      const { resolution } = buildAddOnClient({ resolveResponses: [[addon]] })

      await describeAddon('postgres::sushi', { appIdentity: 'my-app' })

      expect(resolution).toHaveBeenCalledExactlyOnceWith({ addon: 'postgres::sushi' })
    })

    it('falls back to a global resolve when the app-scoped lookup is 404 add_on', async () => {
      const addon = buildAddon()
      const { resolution } = buildAddOnClient({
        resolveResponses: [buildNotFound('add_on'), [addon]],
      })

      const result = await describeAddon('my-postgres', { appIdentity: 'other-app' })

      expect(resolution).toHaveBeenNthCalledWith(1, { addon: 'my-postgres', app: 'other-app' })
      expect(resolution).toHaveBeenNthCalledWith(2, { addon: 'my-postgres' })
      expect(result.id).toBe(addon.id)
    })

    it('rethrows non-add_on 404s without falling back', async () => {
      const error = buildNotFound('app')
      const { resolution } = buildAddOnClient({ resolveResponses: [error] })

      await expect(describeAddon('my-postgres', { appIdentity: 'my-app' })).rejects.toBe(error)
      expect(resolution).toHaveBeenCalledTimes(1)
    })

    it('throws AddonNotFoundError when the resolver returns no matches', async () => {
      buildAddOnClient({ resolveResponses: [[]] })

      await expect(describeAddon('nope')).rejects.toBeInstanceOf(AddonNotFoundError)
    })

    it('throws AddonAmbiguousError when the resolver returns more than one', async () => {
      const matches = [buildAddon({ id: 'a1', name: 'one' }), buildAddon({ id: 'a2', name: 'two' })]
      buildAddOnClient({ resolveResponses: [matches] })

      await expect(describeAddon('ambig')).rejects.toBeInstanceOf(AddonAmbiguousError)
    })

    it('filters resolver matches by addonService when provided', async () => {
      /* eslint-disable camelcase */
      const matches = [
        buildAddon({ addon_service: { name: 'heroku-redis' }, id: 'a1', name: 'redis-app' }),
        buildAddon({ addon_service: { name: 'heroku-postgresql' }, id: 'a2', name: 'pg-app' }),
      ]
      /* eslint-enable camelcase */
      const { resolution } = buildAddOnClient({ resolveResponses: [matches] })

      const result = await describeAddon('shared-name', { addonService: 'heroku-postgresql' })

      // The platform's filter would exclude alpha add-ons, so we filter client-side.
      expect(resolution).toHaveBeenCalledExactlyOnceWith({ addon: 'shared-name' })
      expect(result.id).toBe('a2')
    })

    it('throws AddonNotFoundError when addonService filter eliminates all matches', async () => {
      // eslint-disable-next-line camelcase
      const matches = [buildAddon({ addon_service: { name: 'heroku-redis' }, id: 'a1' })]
      buildAddOnClient({ resolveResponses: [matches] })

      await expect(describeAddon('shared-name', { addonService: 'heroku-postgresql' })).rejects.toBeInstanceOf(AddonNotFoundError)
    })

    it('replaces plan.price with grandfathered cents/contract from billed_price', async () => {
      const addon = buildAddon({
        // eslint-disable-next-line camelcase
        billed_price: { cents: 0, contract: true },
        plan: { id: 'plan-id', name: 'heroku-postgresql:standard-0', price: { cents: 5000, unit: 'month' } },
      })
      buildAddOnClient({ resolveResponses: [[addon]] })

      const result = await describeAddon('my-postgres')

      expect(result.plan).toMatchObject({
        name: 'heroku-postgresql:standard-0',
        price: { cents: 0, contract: true, unit: 'month' },
      })
    })

    it('does not mutate the resolved add-on', async () => {
      const addon = buildAddon({
        // eslint-disable-next-line camelcase
        billed_price: { cents: 0, contract: true },
        plan: { id: 'plan-id', name: 'heroku-postgresql:standard-0', price: { cents: 5000, unit: 'month' } },
      })
      const originalPriceCents = (addon.plan as { price: { cents: number } }).price.cents
      buildAddOnClient({ resolveResponses: [[addon]] })

      const result = await describeAddon('my-postgres')

      // The returned object reflects grandfathered pricing.
      expect((result.plan as { price: { cents: number } }).price.cents).toBe(0)
      // The input add-on is untouched.
      expect((addon.plan as { price: { cents: number } }).price.cents).toBe(originalPriceCents)
      // 'attachments' is not added to the input either.
      expect((addon as Partial<{ attachments: unknown }>).attachments).toBeUndefined()
    })

    it('throws if the resolver returns an add-on missing required ids', async () => {
      const broken = { id: 'addon-id', name: 'broken' } as AddOn // no app
      buildAddOnClient({ resolveResponses: [[broken]] })

      await expect(describeAddon('broken')).rejects.toThrow(/missing required fields/)
    })

    it('throws if the signal is already aborted', async () => {
      const controller = new AbortController()
      controller.abort()

      await expect(describeAddon('my-postgres', { signal: controller.signal })).rejects.toThrow()
      expect(createPlatformClient).not.toHaveBeenCalled()
    })
  })

  describe('resolveAddon', () => {
    it('returns the resolved add-on directly', async () => {
      const addon = buildAddon()
      const { resolution } = buildAddOnClient({ resolveResponses: [[addon]] })

      const result = await resolveAddon('my-postgres', { appIdentity: 'my-app' })

      expect(resolution).toHaveBeenCalledExactlyOnceWith({ addon: 'my-postgres', app: 'my-app' })
      expect(result.id).toBe('addon-id')
    })

    it('throws if the signal is already aborted', async () => {
      const controller = new AbortController()
      controller.abort()

      await expect(resolveAddon('my-postgres', { signal: controller.signal })).rejects.toThrow()
      expect(createPlatformClient).not.toHaveBeenCalled()
    })
  })

  describe('resolveAddonByAttachment', () => {
    it('resolves and returns the add-on from the matched attachment', async () => {
      const resolution = vi.fn().mockResolvedValue([
        { addon: { app: { id: 'app-uuid', name: 'my-app' }, id: 'addon-id', name: 'postgres-addon' } },
      ])
      vi.mocked(createPlatformClient).mockReturnValue({ addOnAttachment: { resolution } } as never)

      const result = await resolveAddonByAttachment('my-app', 'DATABASE_URL')

      expect(resolution).toHaveBeenCalledWith({
        // eslint-disable-next-line camelcase
        addon_attachment: 'DATABASE_URL',
        app: 'my-app',
      })
      expect(result.id).toBe('addon-id')
      expect(result.app.id).toBe('app-uuid')
    })

    it('throws AddonNotFoundError when no attachment matches', async () => {
      const resolution = vi.fn().mockResolvedValue([])
      vi.mocked(createPlatformClient).mockReturnValue({ addOnAttachment: { resolution } } as never)

      await expect(resolveAddonByAttachment('my-app', 'NONEXISTENT')).rejects.toBeInstanceOf(AddonNotFoundError)
    })

    it('throws AddonNotFoundError when the matched attachment lacks an addon id', async () => {
      const resolution = vi.fn().mockResolvedValue([{ addon: { app: { name: 'my-app' }, name: 'incomplete' } }])
      vi.mocked(createPlatformClient).mockReturnValue({ addOnAttachment: { resolution } } as never)

      await expect(resolveAddonByAttachment('my-app', 'DATABASE_URL')).rejects.toBeInstanceOf(AddonNotFoundError)
    })

    it('throws if the signal is already aborted', async () => {
      const controller = new AbortController()
      controller.abort()

      await expect(resolveAddonByAttachment('my-app', 'DATABASE_URL', { signal: controller.signal })).rejects.toThrow()
      expect(createPlatformClient).not.toHaveBeenCalled()
    })
  })
})
