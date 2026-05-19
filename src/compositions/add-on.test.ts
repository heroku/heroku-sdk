import type {AddOn} from '@heroku/types/3.sdk'

import {
  afterEach, describe, expect, it, vi,
} from 'vitest'

import {createPlatformClient} from '../services/platform.js'
import {upgrade} from './add-on.js'

vi.mock('../services/platform.js', () => ({
  createPlatformClient: vi.fn(),
}))

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
})
