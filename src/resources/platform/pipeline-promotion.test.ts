import type {
  PipelinePromotion,
  PipelinePromotionCreateOpts,
  PipelinePromotionTarget,
} from '@heroku/types/3.sdk'
import type {Mock} from 'vitest'

import {HerokuApiClient} from '@heroku/api-client'
import {
  afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest'

import type {ResourceCtx} from '../../core/extend-resource.js'

import {pipelinePromotionExtensions, promotePipeline} from './pipeline-promotion.js'

vi.mock('@heroku/api-client', () => ({
  HerokuApiClient: vi.fn(),
}))

const createBody: PipelinePromotionCreateOpts = {
  pipeline: {id: 'pipeline-1'},
  source: {app: {id: 'source-app'}},
  targets: [{app: {id: 'target-1'}}],
}

function ctxFor(promotion: PipelinePromotion, listResults: PipelinePromotionTarget[][]): {
  create: ReturnType<typeof vi.fn>;
  ctx: ResourceCtx;
  list: ReturnType<typeof vi.fn>;
} {
  const create = vi.fn().mockResolvedValue(promotion)
  const list = vi.fn()
  for (const result of listResults) list.mockResolvedValueOnce(result)

  return {
    create,
    ctx: {
      data: {} as never,
      platform: {
        pipelinePromotion: {create},
        pipelinePromotionTarget: {list},
      } as never,
    },
    list,
  }
}

function mockBuslClient(stream: Mock) {
  const constructorMock = vi.mocked(HerokuApiClient)
  constructorMock.mockImplementation(function (this: {stream: Mock}) {
    this.stream = stream
  } as never)
  return constructorMock
}

function ctxWithRelease(
  promotion: PipelinePromotion,
  listResults: PipelinePromotionTarget[][],
  release: {output_stream_url?: null | string},
): {
  ctx: ResourceCtx
  releaseInfo: ReturnType<typeof vi.fn>
} {
  const create = vi.fn().mockResolvedValue(promotion)
  const list = vi.fn()
  for (const result of listResults) list.mockResolvedValueOnce(result)
  const releaseInfo = vi.fn().mockResolvedValue(release)

  return {
    ctx: {
      data: {} as never,
      platform: {
        pipelinePromotion: {create},
        pipelinePromotionTarget: {list},
        release: {info: releaseInfo},
      } as never,
    },
    releaseInfo,
  }
}

const singleTargetBody: PipelinePromotionCreateOpts = {
  pipeline: {id: 'pipeline-1'},
  source: {app: {id: 'source-app'}},
  targets: [{app: {id: 'target-app-1'}}],
}

describe('pipeline-promotion resource', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  it('promotePipeline returns immediately when all targets are terminal on first poll', async () => {
    const promotion = {id: 'promo-1'} as PipelinePromotion
    const targets: PipelinePromotionTarget[] = [{id: 't1', status: 'succeeded'}]
    const {create, ctx} = ctxFor(promotion, [targets])

    const result = await promotePipeline(ctx, createBody)

    expect(create).toHaveBeenCalledWith(createBody)
    expect(result).toEqual({promotion, targets})
  })

  it('promotePipeline polls until every target reaches a terminal status', async () => {
    const promotion = {id: 'promo-2'} as PipelinePromotion
    const pending: PipelinePromotionTarget[] = [{id: 't1', status: 'pending'}]
    const done: PipelinePromotionTarget[] = [{id: 't1', status: 'succeeded'}]
    const {ctx, list} = ctxFor(promotion, [pending, done])

    const promise = promotePipeline(ctx, createBody, {intervalMs: 500})
    await vi.advanceTimersByTimeAsync(1000)
    const result = await promise

    expect(list).toHaveBeenCalledTimes(2)
    expect(result.targets).toEqual(done)
  })

  it('promotePipeline treats failed targets as terminal and returns them in the result', async () => {
    const promotion = {id: 'promo-failed'} as PipelinePromotion
    const targets: PipelinePromotionTarget[] = [
      {id: 't1', status: 'succeeded'},
      {id: 't2', status: 'failed'},
    ]
    const {ctx} = ctxFor(promotion, [targets])

    const result = await promotePipeline(ctx, createBody)

    expect(result.targets).toEqual(targets)
  })

  it('promotePipeline throws if the create response is missing an id', async () => {
    const {ctx} = ctxFor({} as PipelinePromotion, [])

    await expect(promotePipeline(ctx, createBody)).rejects.toThrow(/did not include an id/)
  })

  it('promotePipeline throws when the timeout elapses before targets reach a terminal status', async () => {
    const promotion = {id: 'promo-3'} as PipelinePromotion
    const pending: PipelinePromotionTarget[] = [{id: 't1', status: 'pending'}]
    const list = vi.fn().mockResolvedValue(pending)
    const ctx: ResourceCtx = {
      data: {} as never,
      platform: {
        pipelinePromotion: {create: vi.fn().mockResolvedValue(promotion)},
        pipelinePromotionTarget: {list},
      } as never,
    }

    const promise = promotePipeline(ctx, createBody, {intervalMs: 100, timeoutMs: 250})
    const expectation = expect(promise).rejects.toThrow(/did not reach a terminal state within 250ms/)
    await vi.advanceTimersByTimeAsync(1000)
    await expectation
  })

  it('promotePipeline aborts polling when the abort signal fires', async () => {
    const promotion = {id: 'promo-4'} as PipelinePromotion
    const pending: PipelinePromotionTarget[] = [{id: 't1', status: 'pending'}]
    const list = vi.fn().mockResolvedValue(pending)
    const ctx: ResourceCtx = {
      data: {} as never,
      platform: {
        pipelinePromotion: {create: vi.fn().mockResolvedValue(promotion)},
        pipelinePromotionTarget: {list},
      } as never,
    }

    const controller = new AbortController()
    const promise = promotePipeline(ctx, createBody, {intervalMs: 1000, signal: controller.signal})
    const expectation = expect(promise).rejects.toThrow(/aborted/i)
    controller.abort()
    await vi.advanceTimersByTimeAsync(0)
    await expectation
  })

  it('promotePipeline hands the release output stream to onReleaseStream and resumes polling', async () => {
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
    const {ctx, releaseInfo} = ctxWithRelease(promotion, [pendingWithRelease, done], {
      // eslint-disable-next-line camelcase
      output_stream_url: 'https://busl.example/release?token=abc',
    })

    const streamBody = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('Release Command Output'))
        controller.close()
      },
    })
    const stream = vi.fn().mockResolvedValue(new Response(streamBody, {status: 200}))
    const constructorMock = mockBuslClient(stream)

    const onReleaseStream = vi.fn(async ({stream: body}: {stream: ReadableStream<Uint8Array>}) => {
      const reader = body.getReader()
      const {value} = await reader.read()
      expect(new TextDecoder().decode(value)).toBe('Release Command Output')
      reader.releaseLock()
    })

    const promise = promotePipeline(ctx, singleTargetBody, {intervalMs: 100, onReleaseStream})
    await vi.advanceTimersByTimeAsync(500)
    const result = await promise

    expect(onReleaseStream).toHaveBeenCalledTimes(1)
    expect(releaseInfo).toHaveBeenCalledWith('target-app-1', 'release-1')
    expect(constructorMock).toHaveBeenCalledWith({
      baseUrl: 'https://busl.example',
      service: 'custom',
      token: '',
    })
    expect(stream).toHaveBeenCalledWith('/release?token=abc', {headers: {Accept: '*/*'}})
    expect(result.targets).toEqual(done)
  })

  it('promotePipeline retries the busl fetch up to releaseStreamMaxAttempts before failing', async () => {
    const promotion = {id: 'promo-retry'} as PipelinePromotion
    const pendingWithRelease: PipelinePromotionTarget[] = [{
      app: {id: 'target-app-1'},
      id: 't1',
      release: {id: 'release-1'},
      status: 'pending',
    }]
    const {ctx} = ctxWithRelease(promotion, [pendingWithRelease], {
      // eslint-disable-next-line camelcase
      output_stream_url: 'https://busl.example/release',
    })

    const stream = vi.fn().mockResolvedValue(new Response('not yet', {status: 404}))
    mockBuslClient(stream)

    const promise = promotePipeline(ctx, singleTargetBody, {
      intervalMs: 1,
      onReleaseStream: vi.fn(),
      releaseStreamMaxAttempts: 3,
    })
    const expectation = expect(promise).rejects.toThrow(/stream release output not available/)
    await vi.advanceTimersByTimeAsync(100)
    await expectation

    expect(stream).toHaveBeenCalledTimes(3)
  })

  it('promotePipeline skips streaming when there are multiple targets', async () => {
    const promotion = {id: 'promo-multi'} as PipelinePromotion
    const pending: PipelinePromotionTarget[] = [
      {
        app: {id: 'target-app-1'}, id: 't1', release: {id: 'release-1'}, status: 'pending',
      },
      {app: {id: 'target-app-2'}, id: 't2', status: 'pending'},
    ]
    const done: PipelinePromotionTarget[] = [
      {app: {id: 'target-app-1'}, id: 't1', status: 'succeeded'},
      {app: {id: 'target-app-2'}, id: 't2', status: 'succeeded'},
    ]
    const {ctx, releaseInfo} = ctxWithRelease(promotion, [pending, done], {
      // eslint-disable-next-line camelcase
      output_stream_url: 'https://busl.example/release',
    })

    const onReleaseStream = vi.fn()
    const stream = vi.fn()
    mockBuslClient(stream)

    const multiTargetBody: PipelinePromotionCreateOpts = {
      pipeline: {id: 'pipeline-1'},
      source: {app: {id: 'source-app'}},
      targets: [{app: {id: 'target-app-1'}}, {app: {id: 'target-app-2'}}],
    }

    const promise = promotePipeline(ctx, multiTargetBody, {intervalMs: 100, onReleaseStream})
    await vi.advanceTimersByTimeAsync(500)
    await promise

    expect(onReleaseStream).not.toHaveBeenCalled()
    expect(releaseInfo).not.toHaveBeenCalled()
    expect(stream).not.toHaveBeenCalled()
  })

  it('promotePipeline skips streaming when the release has no output_stream_url', async () => {
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
    const {ctx} = ctxWithRelease(promotion, [pendingWithRelease, done], {
      // eslint-disable-next-line camelcase
      output_stream_url: null,
    })

    const onReleaseStream = vi.fn()
    const stream = vi.fn()
    mockBuslClient(stream)

    const promise = promotePipeline(ctx, singleTargetBody, {intervalMs: 100, onReleaseStream})
    await vi.advanceTimersByTimeAsync(500)
    await promise

    expect(onReleaseStream).not.toHaveBeenCalled()
    expect(stream).not.toHaveBeenCalled()
  })

  it('pipelinePromotionExtensions declares service: platform, resource: pipelinePromotion', () => {
    expect(pipelinePromotionExtensions.service).toBe('platform')
    expect(pipelinePromotionExtensions.resource).toBe('pipelinePromotion')
  })

  it('pipelinePromotionExtensions factory exposes a promote method', () => {
    const ctx: ResourceCtx = {data: {} as never, platform: {} as never}
    const methods = pipelinePromotionExtensions.factory(ctx)
    expect(typeof methods.promote).toBe('function')
  })
})
