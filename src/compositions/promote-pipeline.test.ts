import type {PipelinePromotion, PipelinePromotionCreateOpts, PipelinePromotionTarget} from '@heroku/types/3.sdk'

import {
  afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest'

import {createHerokuClient} from '../core/create-client.js'
import {promotePipeline} from './promote-pipeline.js'

vi.mock('../core/create-client.js', () => ({
  createHerokuClient: vi.fn(),
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
    vi.mocked(createHerokuClient).mockReturnValue(mockClient as never)

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
    vi.mocked(createHerokuClient).mockReturnValue(mockClient as never)

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
    vi.mocked(createHerokuClient).mockReturnValue(mockClient as never)

    const result = await promotePipeline(createBody)

    expect(result.targets).toEqual(targets)
  })

  it('throws if the create response is missing an id', async () => {
    const promotion = {} as PipelinePromotion
    const {mockClient} = buildClient(promotion, [])
    vi.mocked(createHerokuClient).mockReturnValue(mockClient as never)

    await expect(promotePipeline(createBody)).rejects.toThrow(/did not include an id/)
  })

  it('throws when the timeout elapses before targets reach a terminal status', async () => {
    const promotion = {id: 'promo-4'} as PipelinePromotion
    const pending: PipelinePromotionTarget[] = [{id: 't1', status: 'pending'}]
    const list = vi.fn().mockResolvedValue(pending)
    vi.mocked(createHerokuClient).mockReturnValue({
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
    vi.mocked(createHerokuClient).mockReturnValue({
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

  it('forwards clientOptions to createHerokuClient', async () => {
    const promotion = {id: 'promo-6'} as PipelinePromotion
    const targets: PipelinePromotionTarget[] = [{id: 't1', status: 'succeeded'}]
    const {mockClient} = buildClient(promotion, [targets])
    vi.mocked(createHerokuClient).mockReturnValue(mockClient as never)

    await promotePipeline(createBody, {clientOptions: {token: 'abc'}})

    expect(createHerokuClient).toHaveBeenCalledWith({token: 'abc'})
  })
})
