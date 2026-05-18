import type {PipelinePromotion, PipelinePromotionCreateOpts, PipelinePromotionTarget} from '@heroku/types/3.sdk'

import {
  afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest'

import {createPlatformClient} from '../services/platform.js'
import {promotePipeline} from './pipeline.js'

vi.mock('../services/platform.js', () => ({
  createPlatformClient: vi.fn(),
}))

const createBody: PipelinePromotionCreateOpts = {
  pipeline: {id: 'pipeline-1'},
  source: {app: {id: 'source-app'}},
  targets: [{app: {id: 'target-app-1'}}, {app: {id: 'target-app-2'}}],
}

function buildClient(promotion: PipelinePromotion, listResults: PipelinePromotionTarget[][]) {
  const list = vi.fn()
  for (const result of listResults) {
    list.mockResolvedValueOnce(result)
  }

  const create = vi.fn().mockResolvedValue(promotion)

  return {
    create,
    list,
    mockClient: {
      pipelinePromotion: {create},
      pipelinePromotionTarget: {list},
    },
  }
}

function buildSingleTargetClient(
  promotion: PipelinePromotion,
  listResults: PipelinePromotionTarget[][],
  release: {output_stream_url?: null | string},
) {
  const create = vi.fn().mockResolvedValue(promotion)
  const list = vi.fn()
  for (const result of listResults) {
    list.mockResolvedValueOnce(result)
  }

  const releaseInfo = vi.fn().mockResolvedValue(release)

  return {
    mockClient: {
      pipelinePromotion: {create},
      pipelinePromotionTarget: {list},
      release: {info: releaseInfo},
    },
    releaseInfo,
  }
}

describe('promotePipeline', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  it('returns immediately when all targets are terminal on first poll', async () => {
    const promotion = {id: 'promo-1', status: 'completed'} as PipelinePromotion
    const targets: PipelinePromotionTarget[] = [
      {id: 't1', status: 'succeeded'},
      {id: 't2', status: 'succeeded'},
    ]
    const {create, mockClient} = buildClient(promotion, [targets])
    vi.mocked(createPlatformClient).mockReturnValue(mockClient as never)

    const result = await promotePipeline(createBody)

    expect(create).toHaveBeenCalledWith(createBody)
    expect(result).toEqual({promotion, targets})
  })

  it('polls until every target reaches a terminal status', async () => {
    const promotion = {id: 'promo-2'} as PipelinePromotion
    const pending: PipelinePromotionTarget[] = [
      {id: 't1', status: 'pending'},
      {id: 't2', status: 'pending'},
    ]
    const partial: PipelinePromotionTarget[] = [
      {id: 't1', status: 'succeeded'},
      {id: 't2', status: 'pending'},
    ]
    const done: PipelinePromotionTarget[] = [
      {id: 't1', status: 'succeeded'},
      {id: 't2', status: 'succeeded'},
    ]
    const {list, mockClient} = buildClient(promotion, [pending, partial, done])
    vi.mocked(createPlatformClient).mockReturnValue(mockClient as never)

    const promise = promotePipeline(createBody, {intervalMs: 500})
    await vi.advanceTimersByTimeAsync(1000)
    const result = await promise

    expect(list).toHaveBeenCalledTimes(3)
    expect(result.targets).toEqual(done)
  })

  it('treats failed targets as terminal and returns them in the result', async () => {
    const promotion = {id: 'promo-3'} as PipelinePromotion
    const targets: PipelinePromotionTarget[] = [
      {id: 't1', status: 'succeeded'},
      {id: 't2', status: 'failed'},
    ]
    const {mockClient} = buildClient(promotion, [targets])
    vi.mocked(createPlatformClient).mockReturnValue(mockClient as never)

    const result = await promotePipeline(createBody)

    expect(result.targets).toEqual(targets)
  })

  it('throws if the create response is missing an id', async () => {
    const promotion = {} as PipelinePromotion
    const {mockClient} = buildClient(promotion, [])
    vi.mocked(createPlatformClient).mockReturnValue(mockClient as never)

    await expect(promotePipeline(createBody)).rejects.toThrow(/did not include an id/)
  })

  it('throws when the timeout elapses before targets reach a terminal status', async () => {
    const promotion = {id: 'promo-4'} as PipelinePromotion
    const pending: PipelinePromotionTarget[] = [{id: 't1', status: 'pending'}]
    const list = vi.fn().mockResolvedValue(pending)
    vi.mocked(createPlatformClient).mockReturnValue({
      pipelinePromotion: {create: vi.fn().mockResolvedValue(promotion)},
      pipelinePromotionTarget: {list},
    } as never)

    const promise = promotePipeline(createBody, {intervalMs: 100, timeoutMs: 250})
    const expectation = expect(promise).rejects.toThrow(/did not reach a terminal state within 250ms/)
    await vi.advanceTimersByTimeAsync(1000)
    await expectation
  })

  it('aborts polling when the abort signal fires', async () => {
    const promotion = {id: 'promo-5'} as PipelinePromotion
    const pending: PipelinePromotionTarget[] = [{id: 't1', status: 'pending'}]
    const list = vi.fn().mockResolvedValue(pending)
    vi.mocked(createPlatformClient).mockReturnValue({
      pipelinePromotion: {create: vi.fn().mockResolvedValue(promotion)},
      pipelinePromotionTarget: {list},
    } as never)

    const controller = new AbortController()
    const promise = promotePipeline(createBody, {intervalMs: 1000, signal: controller.signal})
    const expectation = expect(promise).rejects.toThrow(/aborted/i)
    controller.abort()
    await vi.advanceTimersByTimeAsync(0)
    await expectation
  })

  it('forwards clientOptions to createPlatformClient', async () => {
    const promotion = {id: 'promo-6'} as PipelinePromotion
    const targets: PipelinePromotionTarget[] = [{id: 't1', status: 'succeeded'}]
    const {mockClient} = buildClient(promotion, [targets])
    vi.mocked(createPlatformClient).mockReturnValue(mockClient as never)

    await promotePipeline(createBody, {clientOptions: {token: 'abc'}})

    expect(createPlatformClient).toHaveBeenCalledWith({token: 'abc'})
  })

  describe('with onReleaseStream', () => {
    const singleTargetBody: PipelinePromotionCreateOpts = {
      pipeline: {id: 'pipeline-1'},
      source: {app: {id: 'source-app'}},
      targets: [{app: {id: 'target-app-1'}}],
    }

    it('hands the release output stream to onReleaseStream and resumes polling', async () => {
      const promotion = {id: 'promo-stream'} as PipelinePromotion
      const pendingWithRelease: PipelinePromotionTarget[] = [{
        app: {id: 'target-app-1'},
        id: 't1',
        release: {id: 'release-1'},
        status: 'pending',
      }]
      const done: PipelinePromotionTarget[] = [{
        app: {id: 'target-app-1'},
        id: 't1',
        release: {id: 'release-1'},
        status: 'succeeded',
      }]
      const {mockClient, releaseInfo} = buildSingleTargetClient(promotion, [pendingWithRelease, done], {
        // eslint-disable-next-line camelcase
        output_stream_url: 'https://busl.example/release',
      })
      vi.mocked(createPlatformClient).mockReturnValue(mockClient as never)

      const streamBody = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('Release Command Output'))
          controller.close()
        },
      })
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(streamBody, {status: 200}))

      const onReleaseStream = vi.fn(async ({stream}: {stream: ReadableStream<Uint8Array>}) => {
        const reader = stream.getReader()
        const {value} = await reader.read()
        expect(new TextDecoder().decode(value)).toBe('Release Command Output')
        reader.releaseLock()
      })

      const promise = promotePipeline(singleTargetBody, {intervalMs: 100, onReleaseStream})
      await vi.advanceTimersByTimeAsync(500)
      const result = await promise

      expect(onReleaseStream).toHaveBeenCalledTimes(1)
      expect(releaseInfo).toHaveBeenCalledWith('target-app-1', 'release-1')
      expect(fetchSpy).toHaveBeenCalledWith('https://busl.example/release', {signal: undefined})
      expect(result.targets).toEqual(done)

      fetchSpy.mockRestore()
    })

    it('retries the busl fetch up to releaseStreamMaxAttempts before failing', async () => {
      const promotion = {id: 'promo-retry'} as PipelinePromotion
      const pendingWithRelease: PipelinePromotionTarget[] = [{
        app: {id: 'target-app-1'},
        id: 't1',
        release: {id: 'release-1'},
        status: 'pending',
      }]
      const {mockClient} = buildSingleTargetClient(promotion, [pendingWithRelease], {
        // eslint-disable-next-line camelcase
        output_stream_url: 'https://busl.example/release',
      })
      vi.mocked(createPlatformClient).mockReturnValue(mockClient as never)

      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('not yet', {status: 404}))

      const promise = promotePipeline(singleTargetBody, {
        intervalMs: 1,
        onReleaseStream: vi.fn(),
        releaseStreamMaxAttempts: 3,
      })
      const expectation = expect(promise).rejects.toThrow(/stream release output not available/)
      await vi.advanceTimersByTimeAsync(100)
      await expectation

      expect(fetchSpy).toHaveBeenCalledTimes(3)
      fetchSpy.mockRestore()
    })

    it('skips streaming when there are multiple targets', async () => {
      const promotion = {id: 'promo-multi'} as PipelinePromotion
      const pending: PipelinePromotionTarget[] = [
        {
          app: {id: 'target-app-1'},
          id: 't1',
          release: {id: 'release-1'},
          status: 'pending',
        },
        {
          app: {id: 'target-app-2'},
          id: 't2',
          status: 'pending',
        },
      ]
      const done: PipelinePromotionTarget[] = [
        {
          app: {id: 'target-app-1'},
          id: 't1',
          status: 'succeeded',
        },
        {
          app: {id: 'target-app-2'},
          id: 't2',
          status: 'succeeded',
        },
      ]
      const {mockClient, releaseInfo} = buildSingleTargetClient(promotion, [pending, done], {
        // eslint-disable-next-line camelcase
        output_stream_url: 'https://busl.example/release',
      })
      vi.mocked(createPlatformClient).mockReturnValue(mockClient as never)

      const onReleaseStream = vi.fn()
      const fetchSpy = vi.spyOn(globalThis, 'fetch')

      const promise = promotePipeline(createBody, {intervalMs: 100, onReleaseStream})
      await vi.advanceTimersByTimeAsync(500)
      await promise

      expect(onReleaseStream).not.toHaveBeenCalled()
      expect(releaseInfo).not.toHaveBeenCalled()
      expect(fetchSpy).not.toHaveBeenCalled()
      fetchSpy.mockRestore()
    })

    it('skips streaming when the release has no output_stream_url', async () => {
      const promotion = {id: 'promo-no-url'} as PipelinePromotion
      const pendingWithRelease: PipelinePromotionTarget[] = [{
        app: {id: 'target-app-1'},
        id: 't1',
        release: {id: 'release-1'},
        status: 'pending',
      }]
      const done: PipelinePromotionTarget[] = [{
        app: {id: 'target-app-1'},
        id: 't1',
        release: {id: 'release-1'},
        status: 'succeeded',
      }]
      const {mockClient} = buildSingleTargetClient(promotion, [pendingWithRelease, done], {
        // eslint-disable-next-line camelcase
        output_stream_url: null,
      })
      vi.mocked(createPlatformClient).mockReturnValue(mockClient as never)

      const onReleaseStream = vi.fn()
      const fetchSpy = vi.spyOn(globalThis, 'fetch')

      const promise = promotePipeline(singleTargetBody, {intervalMs: 100, onReleaseStream})
      await vi.advanceTimersByTimeAsync(500)
      await promise

      expect(onReleaseStream).not.toHaveBeenCalled()
      expect(fetchSpy).not.toHaveBeenCalled()
      fetchSpy.mockRestore()
    })
  })
})
