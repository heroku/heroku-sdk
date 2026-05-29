import type {Pipeline} from '@heroku/types/3.sdk'

import {HerokuApiClient} from '@heroku/heroku-fetch'
import {
  beforeEach, describe, expect, it, vi,
} from 'vitest'

import type {ResourceCtx} from '../../../core/extend-resource.js'

import {
  PipelineAmbiguousError,
  pipelineExtensions,
  PipelineNotFoundError,
  resolvePipeline,
} from './index.js'

vi.mock('@heroku/heroku-fetch', () => ({
  HerokuApiClient: vi.fn(),
}))

const SOME_UUID = '01234567-89ab-cdef-0123-456789abcdef'

function ctxWithInfo(info: ReturnType<typeof vi.fn>): ResourceCtx {
  return {
    data: {} as never,
    platform: {pipeline: {info}} as never,
  }
}

function mockGet(matches: Pipeline[]): ReturnType<typeof vi.fn> {
  const get = vi.fn().mockResolvedValue(new Response(JSON.stringify(matches), {
    headers: {'content-type': 'application/json'},
    status: 200,
  }))
  vi.mocked(HerokuApiClient).mockImplementation(function (this: {get: typeof get}) {
    this.get = get
  } as never)
  return get
}

describe('pipeline resource', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('resolvePipeline', () => {
    it('fetches by id when given a UUID', async () => {
      const pipeline = {id: SOME_UUID, name: 'my-pipeline'} as Pipeline
      const info = vi.fn().mockResolvedValue(pipeline)
      const ctx = ctxWithInfo(info)

      const result = await resolvePipeline(ctx, SOME_UUID)

      expect(info).toHaveBeenCalledExactlyOnceWith(SOME_UUID)
      expect(HerokuApiClient).not.toHaveBeenCalled()
      expect(result).toBe(pipeline)
    })

    it('looks up by name via a raw HerokuApiClient when given a non-UUID', async () => {
      const pipeline = {id: SOME_UUID, name: 'my-pipeline'} as Pipeline
      const info = vi.fn()
      const ctx = ctxWithInfo(info)
      const get = mockGet([pipeline])

      const result = await resolvePipeline(ctx, 'my-pipeline')

      expect(info).not.toHaveBeenCalled()
      expect(HerokuApiClient).toHaveBeenCalledExactlyOnceWith({service: 'platform'})
      expect(get).toHaveBeenCalledExactlyOnceWith('/pipelines', {
        searchParams: {'eq[name]': 'my-pipeline'},
      })
      expect(result).toEqual(pipeline)
    })

    it('forwards clientOptions to the raw HerokuApiClient', async () => {
      const ctx = ctxWithInfo(vi.fn())
      mockGet([{id: SOME_UUID, name: 'my-pipeline'} as Pipeline])

      await resolvePipeline(ctx, 'my-pipeline', {clientOptions: {token: 'abc'}})

      expect(HerokuApiClient).toHaveBeenCalledWith({service: 'platform', token: 'abc'})
    })

    it('throws PipelineNotFoundError when no pipelines match the name', async () => {
      const ctx = ctxWithInfo(vi.fn())
      mockGet([])

      await expect(resolvePipeline(ctx, 'nope')).rejects.toBeInstanceOf(PipelineNotFoundError)
    })

    it('throws PipelineAmbiguousError when multiple pipelines match the name', async () => {
      const matches = [
        {id: '11111111-1111-1111-1111-111111111111', name: 'shared'},
        {id: '22222222-2222-2222-2222-222222222222', name: 'shared'},
      ] as Pipeline[]
      const ctx = ctxWithInfo(vi.fn())
      mockGet(matches)

      const error = await resolvePipeline(ctx, 'shared').catch(error_ => error_)
      expect(error).toBeInstanceOf(PipelineAmbiguousError)
      expect((error as PipelineAmbiguousError).matches).toEqual(matches)
    })

    it('throws if the signal is already aborted', async () => {
      const info = vi.fn()
      const ctx = ctxWithInfo(info)
      const controller = new AbortController()
      controller.abort()

      await expect(resolvePipeline(ctx, SOME_UUID, {signal: controller.signal})).rejects.toThrow()
      expect(info).not.toHaveBeenCalled()
      expect(HerokuApiClient).not.toHaveBeenCalled()
    })
  })

  describe('pipelineExtensions', () => {
    it('declares service: platform, resource: pipeline', () => {
      expect(pipelineExtensions.service).toBe('platform')
      expect(pipelineExtensions.resource).toBe('pipeline')
    })

    it('factory exposes resolve()', () => {
      const ctx = ctxWithInfo(vi.fn())
      const methods = pipelineExtensions.factory(ctx)
      expect(typeof methods.resolve).toBe('function')
    })

    it('resolve delegates to resolvePipeline', async () => {
      const pipeline = {id: SOME_UUID, name: 'my-pipeline'} as Pipeline
      const info = vi.fn().mockResolvedValue(pipeline)
      const ctx = ctxWithInfo(info)
      const methods = pipelineExtensions.factory(ctx)

      const result = await methods.resolve(SOME_UUID)

      expect(info).toHaveBeenCalledWith(SOME_UUID)
      expect(result).toBe(pipeline)
    })
  })
})
