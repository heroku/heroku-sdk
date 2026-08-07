import {Domain} from '@heroku/types/3.sdk'
import {
  afterEach, describe, expect, it, vi,
} from 'vitest'

import {waitForReady} from './index.js'
import {buildCtx, buildDomain} from './test-utils.js'

// Used to avoid timeouts in tests
const WAIT_INTERVAL_MS = 5

describe('waitForReady', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('with hostname', () => {
    it('waits for domain to be ready', async () => {
      const pending = buildDomain({hostname: 'example.com', id: 'domain-1', status: 'pending'})
      const ready = buildDomain({hostname: 'example.com', id: 'domain-1', status: 'succeeded'})
      const ctx = buildCtx({
        domainInfo: vi.fn()
          .mockResolvedValueOnce(pending)
          .mockResolvedValueOnce(ready),
      })

      const result = await waitForReady(ctx, 'test-app', {
        hostname: 'example.com',
        waitIntervalMs: WAIT_INTERVAL_MS,
      })

      expect(result).toEqual([ready])
      expect(ctx.platform.domain.info).toHaveBeenCalledTimes(2)
      expect(ctx.platform.domain.info).toHaveBeenNthCalledWith(1, 'test-app', 'example.com')
      expect(ctx.platform.domain.info).toHaveBeenNthCalledWith(2, 'test-app', 'domain-1')
    })

    it('returns immediately if already ready', async () => {
      const domain = buildDomain({hostname: 'example.com', status: 'succeeded'})
      const ctx = buildCtx({
        domainInfo: vi.fn().mockResolvedValue(domain),
      })

      const result = await waitForReady(ctx, 'test-app', {
        hostname: 'example.com',
        waitIntervalMs: WAIT_INTERVAL_MS,
      })

      expect(result).toEqual([domain])
      expect(ctx.platform.domain.info).toHaveBeenCalledTimes(1)
    })

    it('accepts none as ready status', async () => {
      const domain = buildDomain({hostname: 'example.com', status: 'none'})
      const ctx = buildCtx({
        domainInfo: vi.fn().mockResolvedValue(domain),
      })

      const result = await waitForReady(ctx, 'test-app', {
        hostname: 'example.com',
        waitIntervalMs: WAIT_INTERVAL_MS,
      })

      expect(result).toEqual([domain])
      expect(ctx.platform.domain.info).toHaveBeenCalledTimes(1)
    })

    it('throws an error on non-ready status', async () => {
      const pending = buildDomain({hostname: 'example.com', status: 'pending'})
      const failed = buildDomain({hostname: 'example.com', status: 'failed'})

      const ctx = buildCtx({
        domainInfo: vi.fn()
          .mockResolvedValueOnce(pending)
          .mockResolvedValueOnce(failed),
      })

      await expect(waitForReady(ctx, 'test-app', {
        hostname: 'example.com',
        waitIntervalMs: WAIT_INTERVAL_MS,
      })).rejects.toThrow('The domain creation finished with status failed')
    })

    it('respects timeout', async () => {
      const pending = buildDomain({status: 'pending'})
      const ctx = buildCtx({
        domainInfo: vi.fn().mockResolvedValue(pending),
      })

      await expect(waitForReady(ctx, 'test-app', {
        hostname: 'example.com',
        timeoutMs: WAIT_INTERVAL_MS * 2,
        waitIntervalMs: WAIT_INTERVAL_MS,
      })).rejects.toThrow('Timed out waiting for domain example.com')

      // depending on the speed of the test, we may have more calls, but we should have at least 2
      // call 1: before loop starts
      // call 2: first loop iteration
      expect(vi.mocked(ctx.platform.domain.info).mock.calls.length).toBeGreaterThanOrEqual(2)
    })

    it('respects signal cancellation', async () => {
      const controller = new AbortController()
      let callCount = 0

      const pending = buildDomain({hostname: 'example.com', status: 'pending'})
      const ctx = buildCtx({
        domainInfo: vi.fn()
          .mockImplementation(() => {
            callCount++
            if (callCount === 2) {
              controller.abort()
            }

            return Promise.resolve(pending)
          }),
      })

      await expect(waitForReady(ctx, 'test-app', {
        hostname: 'example.com',
        signal: controller.signal,
        waitIntervalMs: WAIT_INTERVAL_MS,
      })).rejects.toThrow()

      expect(ctx.platform.domain.info).toHaveBeenCalledTimes(2)
    })
  })

  describe('with app name only', () => {
    it('returns empty array if no pending domains', async () => {
      const ready1 = buildDomain({hostname: 'one.com', id: 'domain-1', status: 'succeeded'})
      const ready2 = buildDomain({hostname: 'two.com', id: 'domain-2', status: 'none'})
      const ctx = buildCtx({
        domainList: vi.fn().mockResolvedValue([ready1, ready2]),
      })

      const result = await waitForReady(ctx, 'test-app')
      expect(result).toEqual([])
      expect(ctx.platform.domain.info).not.toHaveBeenCalled()
    })

    it('filters out non-pending domains and only waits for pending ones', async () => {
      const succeeded = buildDomain({hostname: 'one.com', id: 'domain-1', status: 'succeeded'})
      const none = buildDomain({hostname: 'two.com', id: 'domain-2', status: 'none'})
      const failed = buildDomain({hostname: 'three.com', id: 'domain-3', status: 'failed'})
      const pending = buildDomain({hostname: 'four.com', id: 'domain-4', status: 'pending'})
      const ready = buildDomain({hostname: 'four.com', id: 'domain-4', status: 'succeeded'})

      const ctx = buildCtx({
        domainInfo: vi.fn().mockResolvedValueOnce(ready),
        domainList: vi.fn().mockResolvedValue([succeeded, none, failed, pending]),
      })

      const result = await waitForReady(ctx, 'test-app', {waitIntervalMs: WAIT_INTERVAL_MS})
      expect(result).toEqual([ready])
      expect(ctx.platform.domain.info).toHaveBeenCalledTimes(1)
      expect(ctx.platform.domain.info).toHaveBeenCalledWith('test-app', 'domain-4')
    })

    it('waits for all pending domains sequentially', async () => {
      const pending1 = buildDomain({hostname: 'one.com', id: 'domain-1', status: 'pending'})
      const pending2 = buildDomain({hostname: 'two.com', id: 'domain-2', status: 'pending'})
      const ready1 = buildDomain({hostname: 'one.com', id: 'domain-1', status: 'succeeded'})
      const ready2 = buildDomain({hostname: 'two.com', id: 'domain-2', status: 'succeeded'})
      const ctx = buildCtx({
        domainInfo: vi.fn()
          .mockResolvedValueOnce(ready1)
          .mockResolvedValueOnce(ready2),
        domainList: vi.fn().mockResolvedValue([pending1, pending2]),
      })

      const result = await waitForReady(ctx, 'test-app', {waitIntervalMs: WAIT_INTERVAL_MS})
      expect(result).toEqual([ready1, ready2])
      expect(ctx.platform.domain.info).toHaveBeenNthCalledWith(1, 'test-app', 'domain-1')
      expect(ctx.platform.domain.info).toHaveBeenNthCalledWith(2, 'test-app', 'domain-2')
    })

    it('throws when one pending domain reaches non-ready status', async () => {
      const pending1 = buildDomain({hostname: 'one.com', id: 'domain-1', status: 'pending'})
      const pending2 = buildDomain({hostname: 'two.com', id: 'domain-2', status: 'pending'})
      const ready = buildDomain({hostname: 'one.com', id: 'domain-1', status: 'succeeded'})
      const failed = buildDomain({hostname: 'two.com', id: 'domain-2', status: 'failed'})
      const ctx = buildCtx({
        domainInfo: vi.fn()
          .mockResolvedValueOnce(ready)
          .mockResolvedValueOnce(failed),
        domainList: vi.fn().mockResolvedValue([pending1, pending2]),
      })

      await expect(waitForReady(ctx, 'test-app', {
        waitIntervalMs: WAIT_INTERVAL_MS,
      })).rejects.toThrow('The domain creation finished with status failed')
      expect(ctx.platform.domain.info).toHaveBeenCalledTimes(2)
    })
  })

  describe('with domain object', () => {
    it('waits for domain to be ready', async () => {
      const pending = buildDomain({id: 'domain-1', status: 'pending'})
      const ready = buildDomain({id: 'domain-1', status: 'succeeded'})
      const ctx = buildCtx({
        domainInfo: vi.fn().mockResolvedValueOnce(ready),
      })

      const result = await waitForReady(ctx, 'test-app', {
        domain: pending,
        waitIntervalMs: WAIT_INTERVAL_MS,
      })
      expect(result).toEqual([ready])
      expect(ctx.platform.domain.info).toHaveBeenCalledWith('test-app', 'domain-1')
    })

    it('returns immediately if already ready', async () => {
      const ready = buildDomain({status: 'succeeded'})
      const ctx = buildCtx()

      const result = await waitForReady(ctx, 'test-app', {domain: ready})
      expect(result).toEqual([ready])
      expect(ctx.platform.domain.info).not.toHaveBeenCalled()
    })
  })

  describe('error handling', () => {
    it('throws when domain.info fails during polling', async () => {
      const pending = buildDomain({id: 'domain-123', status: 'pending'})
      const ctx = buildCtx({
        domainInfo: vi.fn().mockRejectedValue(new Error('API error')),
      })

      await expect(waitForReady(ctx, 'test-app', {
        domain: pending,
        waitIntervalMs: WAIT_INTERVAL_MS,
      })).rejects.toThrow('API error')
    })

    it('throws when domain.list fails', async () => {
      const ctx = buildCtx({
        domainList: vi.fn().mockRejectedValue(new Error('List API error')),
      })

      await expect(waitForReady(ctx, 'test-app')).rejects.toThrow('List API error')
    })

    it('calls onPoll for each domain', async () => {
      const calls: string[] = []

      const pending1 = buildDomain({id: 'domain-1', status: 'pending'})
      const pending2 = buildDomain({id: 'domain-2', status: 'pending'})
      const ready1 = buildDomain({id: 'domain-1', status: 'succeeded'})
      const ready2 = buildDomain({id: 'domain-2', status: 'succeeded'})

      const ctx = buildCtx({
        domainInfo: vi.fn()
          .mockImplementation(async (_appIdentity: string, domainId: string) => {
            calls.push(`info:${domainId}`)
            return buildDomain({id: domainId, status: 'succeeded'})
          }),
        domainList: vi.fn().mockResolvedValue([pending1, pending2]),
      })

      const onStart = vi.fn((domain: Domain) => calls.push(`start:${domain.id}`))
      const onStop = vi.fn((domain: Domain) => calls.push(`stop:${domain.id}`))

      const result = await waitForReady(ctx, 'test-app', {
        onPoll: {onStart, onStop},
        waitIntervalMs: WAIT_INTERVAL_MS,
      })

      expect(calls).toEqual([
        'start:domain-1',
        'info:domain-1',
        'stop:domain-1',
        'start:domain-2',
        'info:domain-2',
        'stop:domain-2',
      ])
      expect(onStart).toHaveBeenCalledTimes(2)
      expect(onStop).toHaveBeenCalledTimes(2)
      expect(result).toEqual([ready1, ready2])
    })
  })
})
