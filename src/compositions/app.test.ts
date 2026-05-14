import type {App} from '@heroku/types/3.sdk'

import {
  afterEach, describe, expect, it, vi,
} from 'vitest'

import {createPlatformClient} from '../services/platform.js'
import {disableMaintenanceMode, enableMaintenanceMode} from './app.js'

vi.mock('../services/platform.js', () => ({
  createPlatformClient: vi.fn(),
}))

describe('app compositions', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('enableMaintenanceMode', () => {
    it('calls app.update with maintenance: true', async () => {
      const app = {maintenance: true, name: 'app-1'} as App
      const update = vi.fn().mockResolvedValue(app)
      vi.mocked(createPlatformClient).mockReturnValue({app: {update}} as never)

      const result = await enableMaintenanceMode('app-1')

      expect(update).toHaveBeenCalledWith('app-1', {maintenance: true})
      expect(result).toBe(app)
    })

    it('throws if the signal is already aborted', async () => {
      const controller = new AbortController()
      controller.abort()

      await expect(enableMaintenanceMode('app-1', {signal: controller.signal})).rejects.toThrow()
      expect(createPlatformClient).not.toHaveBeenCalled()
    })
  })

  describe('disableMaintenanceMode', () => {
    it('calls app.update with maintenance: false', async () => {
      const app = {maintenance: false, name: 'app-1'} as App
      const update = vi.fn().mockResolvedValue(app)
      vi.mocked(createPlatformClient).mockReturnValue({app: {update}} as never)

      const result = await disableMaintenanceMode('app-1')

      expect(update).toHaveBeenCalledWith('app-1', {maintenance: false})
      expect(result).toBe(app)
    })

    it('throws if the signal is already aborted', async () => {
      const controller = new AbortController()
      controller.abort()

      await expect(disableMaintenanceMode('app-1', {signal: controller.signal})).rejects.toThrow()
      expect(createPlatformClient).not.toHaveBeenCalled()
    })
  })
})
