import type {AddOn, AddOnAttachment} from '@heroku/types/3.sdk'

import {NotFoundError} from '@heroku/api-client'
import {
  afterEach, describe, expect, it, vi,
} from 'vitest'

import {createPlatformClient} from '../services/platform.js'
import {describeAddon, upgrade} from './add-on.js'

vi.mock('../services/platform.js', () => ({
  createPlatformClient: vi.fn(),
}))

function buildAddon(overrides: Partial<AddOn> = {}): AddOn {
  return {
    // eslint-disable-next-line camelcase
    billed_price: {cents: 5000, contract: false},
    id: 'addon-id',
    name: 'my-postgres',
    plan: {id: 'plan-id', name: 'heroku-postgresql:standard-0', price: {cents: 5000, unit: 'month'}},
    ...overrides,
  } as AddOn
}

function buildAddOnClient({
  attachments = [],
  resolveResponses,
}: {
  attachments?: AddOnAttachment[]
  resolveResponses: Array<AddOn[] | Error>
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

  const client = {
    addOn: {resolution},
    addOnAttachment: {listByAddOn},
  }
  vi.mocked(createPlatformClient).mockReturnValue(client as never)

  return {listByAddOn, resolution}
}

function buildNotFound(resource = 'add_on'): NotFoundError {
  const response = new Response(JSON.stringify({id: 'not_found', resource}), {
    headers: {'content-type': 'application/json'},
    status: 404,
  })
  return new NotFoundError(response, {id: 'not_found'})
}

describe('add-on compositions', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('upgrade', () => {
    it('calls addOn.update with the plan', async () => {
      const addOn = {name: 'heroku-postgresql', plan: {name: 'premium-0'}} as AddOn
      const update = vi.fn().mockResolvedValue(addOn)
      vi.mocked(createPlatformClient).mockReturnValue({addOn: {update}} as never)

      const result = await upgrade('my-app', 'heroku-postgresql', 'heroku-postgresql:premium-0')

      expect(update).toHaveBeenCalledWith('my-app', 'heroku-postgresql', {plan: 'heroku-postgresql:premium-0'})
      expect(result).toBe(addOn)
    })

    it('forwards clientOptions to createPlatformClient', async () => {
      const update = vi.fn().mockResolvedValue({} as AddOn)
      vi.mocked(createPlatformClient).mockReturnValue({addOn: {update}} as never)

      await upgrade('my-app', 'addon-1', 'plan-1', {clientOptions: {token: 'test-token'}})

      expect(createPlatformClient).toHaveBeenCalledWith({token: 'test-token'})
    })

    it('throws if the signal is already aborted', async () => {
      const controller = new AbortController()
      controller.abort()

      await expect(upgrade('my-app', 'addon-1', 'plan-1', {signal: controller.signal})).rejects.toThrow()
      expect(createPlatformClient).not.toHaveBeenCalled()
    })
  })

  describe('describeAddon', () => {
    it('resolves the add-on globally when no app is given', async () => {
      const addon = buildAddon()
      const {listByAddOn, resolution} = buildAddOnClient({
        attachments: [{id: 'att-1'} as AddOnAttachment],
        resolveResponses: [[addon]],
      })

      const result = await describeAddon('my-postgres')

      expect(resolution).toHaveBeenCalledExactlyOnceWith({addon: 'my-postgres'})
      expect(listByAddOn).toHaveBeenCalledWith(addon.id)
      expect(result.attachments).toEqual([{id: 'att-1'}])
    })

    it('resolves scoped to an app when one is provided', async () => {
      const addon = buildAddon()
      const {resolution} = buildAddOnClient({resolveResponses: [[addon]]})

      await describeAddon('my-postgres', {appIdentity: 'my-app'})

      expect(resolution).toHaveBeenCalledExactlyOnceWith({addon: 'my-postgres', app: 'my-app'})
    })

    it('skips the app-scoped lookup for namespaced identities', async () => {
      const addon = buildAddon()
      const {resolution} = buildAddOnClient({resolveResponses: [[addon]]})

      await describeAddon('postgres::sushi', {appIdentity: 'my-app'})

      expect(resolution).toHaveBeenCalledExactlyOnceWith({addon: 'postgres::sushi'})
    })

    it('falls back to a global resolve when the app-scoped lookup is 404 add_on', async () => {
      const addon = buildAddon()
      const {resolution} = buildAddOnClient({
        resolveResponses: [buildNotFound('add_on'), [addon]],
      })

      const result = await describeAddon('my-postgres', {appIdentity: 'other-app'})

      expect(resolution).toHaveBeenNthCalledWith(1, {addon: 'my-postgres', app: 'other-app'})
      expect(resolution).toHaveBeenNthCalledWith(2, {addon: 'my-postgres'})
      expect(result.id).toBe(addon.id)
    })

    it('rethrows non-add_on 404s without falling back', async () => {
      const error = buildNotFound('app')
      const {resolution} = buildAddOnClient({resolveResponses: [error]})

      await expect(describeAddon('my-postgres', {appIdentity: 'my-app'})).rejects.toBe(error)
      expect(resolution).toHaveBeenCalledTimes(1)
    })

    it('throws not_found when the resolver returns no matches', async () => {
      buildAddOnClient({resolveResponses: [[]]})

      await expect(describeAddon('nope')).rejects.toMatchObject({
        id: 'not_found',
        statusCode: 404,
      })
    })

    it('throws multiple_matches when the resolver returns more than one', async () => {
      const matches = [buildAddon({id: 'a1', name: 'one'}), buildAddon({id: 'a2', name: 'two'})]
      buildAddOnClient({resolveResponses: [matches]})

      await expect(describeAddon('ambig')).rejects.toMatchObject({
        id: 'multiple_matches',
        statusCode: 422,
      })
    })

    it('replaces plan.price with grandfathered cents/contract from billed_price', async () => {
      const addon = buildAddon({
        // eslint-disable-next-line camelcase
        billed_price: {cents: 0, contract: true},
        plan: {id: 'plan-id', name: 'heroku-postgresql:standard-0', price: {cents: 5000, unit: 'month'}},
      })
      buildAddOnClient({resolveResponses: [[addon]]})

      const result = await describeAddon('my-postgres')

      expect(result.plan).toMatchObject({
        name: 'heroku-postgresql:standard-0',
        price: {cents: 0, contract: true, unit: 'month'},
      })
    })

    it('throws if the signal is already aborted', async () => {
      const controller = new AbortController()
      controller.abort()

      await expect(describeAddon('my-postgres', {signal: controller.signal})).rejects.toThrow()
      expect(createPlatformClient).not.toHaveBeenCalled()
    })
  })
})
