import type {Pipeline} from '@heroku/types/3.sdk'

import {
  describe, expect, it, vi,
} from 'vitest'

import type {ResourceCtx} from '../../core/extend-resource.js'

import {
  PipelineAmbiguousError,
  pipelineExtensions,
  PipelineNotFoundError,
  resolvePipeline,
} from './pipeline.js'

const SOME_UUID = '01234567-89ab-cdef-0123-456789abcdef'

function buildCtx({infoResponse, listResponse}: {
  infoResponse?: Pipeline | Promise<Pipeline>
  listResponse?: Pipeline[] | Promise<Pipeline[]>
} = {}): {
  ctx: ResourceCtx
  info: ReturnType<typeof vi.fn>
  list: ReturnType<typeof vi.fn>
  withSearchParams: ReturnType<typeof vi.fn>
} {
  const info = vi.fn().mockResolvedValue(infoResponse)
  const list = vi.fn().mockResolvedValue(listResponse ?? [])

  const platform = {
    pipeline: {info, list},
    withSearchParams: vi.fn(),
  }
  // withSearchParams should return a same-shaped client; the mock is self-referential.
  platform.withSearchParams.mockReturnValue(platform)

  return {
    ctx: {data: {} as never, platform: platform as never},
    info,
    list,
    withSearchParams: platform.withSearchParams,
  }
}

describe('pipeline resource', () => {
  describe('resolvePipeline', () => {
    it('fetches by id when given a UUID', async () => {
      const pipeline = {id: SOME_UUID, name: 'my-pipeline'} as Pipeline
      const {ctx, info, list, withSearchParams} = buildCtx({infoResponse: pipeline})

      const result = await resolvePipeline(ctx, SOME_UUID)

      expect(info).toHaveBeenCalledExactlyOnceWith(SOME_UUID)
      expect(list).not.toHaveBeenCalled()
      expect(withSearchParams).not.toHaveBeenCalled()
      expect(result).toBe(pipeline)
    })

    it('looks up by name via withSearchParams when given a non-UUID', async () => {
      const pipeline = {id: SOME_UUID, name: 'my-pipeline'} as Pipeline
      const {ctx, info, list, withSearchParams} = buildCtx({listResponse: [pipeline]})

      const result = await resolvePipeline(ctx, 'my-pipeline')

      expect(info).not.toHaveBeenCalled()
      expect(withSearchParams).toHaveBeenCalledExactlyOnceWith({'eq[name]': 'my-pipeline'})
      expect(list).toHaveBeenCalledExactlyOnceWith()
      expect(result).toBe(pipeline)
    })

    it('throws PipelineNotFoundError when no pipelines match the name', async () => {
      const {ctx} = buildCtx({listResponse: []})

      await expect(resolvePipeline(ctx, 'nope')).rejects.toBeInstanceOf(PipelineNotFoundError)
    })

    it('throws PipelineAmbiguousError when multiple pipelines match the name', async () => {
      const matches = [
        {id: '11111111-1111-1111-1111-111111111111', name: 'shared'},
        {id: '22222222-2222-2222-2222-222222222222', name: 'shared'},
      ] as Pipeline[]
      const {ctx} = buildCtx({listResponse: matches})

      const error = await resolvePipeline(ctx, 'shared').catch(error_ => error_)
      expect(error).toBeInstanceOf(PipelineAmbiguousError)
      expect((error as PipelineAmbiguousError).matches).toBe(matches)
    })

    it('throws if the signal is already aborted', async () => {
      const {ctx, info, list} = buildCtx()
      const controller = new AbortController()
      controller.abort()

      await expect(resolvePipeline(ctx, SOME_UUID, {signal: controller.signal})).rejects.toThrow()
      expect(info).not.toHaveBeenCalled()
      expect(list).not.toHaveBeenCalled()
    })
  })

  describe('pipelineExtensions', () => {
    it('declares service: platform, resource: pipeline', () => {
      expect(pipelineExtensions.service).toBe('platform')
      expect(pipelineExtensions.resource).toBe('pipeline')
    })

    it('factory exposes resolve()', () => {
      const {ctx} = buildCtx()
      const methods = pipelineExtensions.factory(ctx)
      expect(typeof methods.resolve).toBe('function')
    })

    it('resolve delegates to resolvePipeline', async () => {
      const pipeline = {id: SOME_UUID, name: 'my-pipeline'} as Pipeline
      const {ctx, info} = buildCtx({infoResponse: pipeline})
      const methods = pipelineExtensions.factory(ctx)

      const result = await methods.resolve(SOME_UUID)

      expect(info).toHaveBeenCalledWith(SOME_UUID)
      expect(result).toBe(pipeline)
    })
  })
})
