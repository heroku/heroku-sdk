import type { Formation } from '@heroku/types/3.sdk'

import {
  afterEach, describe, expect, it, vi,
} from 'vitest'

import { createPlatformClient } from '../services/platform.js'
import { restartDynos, scaleDynos } from './dyno.js'

vi.mock('../services/platform.js', () => ({
  createPlatformClient: vi.fn(),
}))

describe('dyno compositions', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('scaleDynos', () => {
    it('routes a single update object to formation.update', async () => {
      const formation = { quantity: 3, type: 'web' } as Formation
      const update = vi.fn().mockResolvedValue(formation)
      const batchUpdate = vi.fn()
      vi.mocked(createPlatformClient).mockReturnValue({ formation: { batchUpdate, update } } as never)

      const result = await scaleDynos('app-1', { quantity: 3, type: 'web' })

      expect(update).toHaveBeenCalledWith('app-1', 'web', { quantity: 3 })
      expect(batchUpdate).not.toHaveBeenCalled()
      expect(result).toBe(formation)
    })

    it('routes an updates array to formation.batchUpdate', async () => {
      const formations = [
        { quantity: 2, type: 'web' } as Formation,
        { quantity: 1, type: 'worker' } as Formation,
      ]
      const update = vi.fn()
      const batchUpdate = vi.fn().mockResolvedValue(formations)
      vi.mocked(createPlatformClient).mockReturnValue({ formation: { batchUpdate, update } } as never)

      const updates = [
        { quantity: 2, type: 'web' },
        { quantity: 1, type: 'worker' },
      ]
      const result = await scaleDynos('app-1', updates)

      expect(batchUpdate).toHaveBeenCalledWith('app-1', { updates })
      expect(update).not.toHaveBeenCalled()
      expect(result).toBe(formations)
    })

    it('routes a single-element array to batchUpdate, not update', async () => {
      const formations = [{ quantity: 2, type: 'web' } as Formation]
      const update = vi.fn()
      const batchUpdate = vi.fn().mockResolvedValue(formations)
      vi.mocked(createPlatformClient).mockReturnValue({ formation: { batchUpdate, update } } as never)

      await scaleDynos('app-1', [{ quantity: 2, type: 'web' }])

      expect(batchUpdate).toHaveBeenCalledTimes(1)
      expect(update).not.toHaveBeenCalled()
    })

    it('throws if the signal is already aborted', async () => {
      const controller = new AbortController()
      controller.abort()

      await expect(scaleDynos('app-1', { quantity: 1, type: 'web' }, { signal: controller.signal }))
        .rejects.toThrow()
      expect(createPlatformClient).not.toHaveBeenCalled()
    })
  })

  describe('restartDynos', () => {
    it('restarts all dynos when no target is provided', async () => {
      const restartAll = vi.fn().mockResolvedValue()
      const restart = vi.fn()
      const restartFormation = vi.fn()
      vi.mocked(createPlatformClient).mockReturnValue({
        dyno: { restart, restartAll, restartFormation },
      } as never)

      await restartDynos('app-1')

      expect(restartAll).toHaveBeenCalledWith('app-1')
      expect(restart).not.toHaveBeenCalled()
      expect(restartFormation).not.toHaveBeenCalled()
    })

    it('restarts a formation when target is a process type', async () => {
      const restartAll = vi.fn()
      const restart = vi.fn()
      const restartFormation = vi.fn().mockResolvedValue()
      vi.mocked(createPlatformClient).mockReturnValue({
        dyno: { restart, restartAll, restartFormation },
      } as never)

      await restartDynos('app-1', { type: 'web' })

      expect(restartFormation).toHaveBeenCalledWith('app-1', 'web')
      expect(restart).not.toHaveBeenCalled()
      expect(restartAll).not.toHaveBeenCalled()
    })

    it('restarts a specific dyno when target is a dyno name', async () => {
      const restartAll = vi.fn()
      const restart = vi.fn().mockResolvedValue()
      const restartFormation = vi.fn()
      vi.mocked(createPlatformClient).mockReturnValue({
        dyno: { restart, restartAll, restartFormation },
      } as never)

      await restartDynos('app-1', { dyno: 'web.1' })

      expect(restart).toHaveBeenCalledWith('app-1', 'web.1')
      expect(restartAll).not.toHaveBeenCalled()
      expect(restartFormation).not.toHaveBeenCalled()
    })

    it('throws if the signal is already aborted', async () => {
      const controller = new AbortController()
      controller.abort()

      await expect(restartDynos('app-1', undefined, { signal: controller.signal })).rejects.toThrow()
      expect(createPlatformClient).not.toHaveBeenCalled()
    })
  })
})
