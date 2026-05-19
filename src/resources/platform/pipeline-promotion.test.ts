import type {
  PipelinePromotion,
  PipelinePromotionCreateOpts,
  PipelinePromotionTarget,
} from '@heroku/types/3.sdk'

import {
  afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest'

import type {ResourceCtx} from '../../core/extend-resource.js'

import {pipelinePromotionExtensions, promotePipeline} from './pipeline-promotion.js'

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
