import {HerokuApiClient} from '@heroku/api-client'
import {
  beforeEach, describe, expect, it, vi,
} from 'vitest'

import type {ResourceCtx} from '../../core/extend-resource.js'

import {listPipelineApps, pipelineCouplingExtensions} from './pipeline-coupling.js'

vi.mock('@heroku/api-client', () => ({
  HerokuApiClient: vi.fn(),
}))

function ctxWithListByPipeline(listByPipeline: ReturnType<typeof vi.fn>): ResourceCtx {
  return {
    data: {} as never,
    platform: {
      pipelineCoupling: {listByPipeline},
    } as never,
  }
}

describe('pipeline-coupling resource', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('listPipelineApps returns merged app+coupling rows', async () => {
    const couplings = [
      {app: {id: 'app-1'}, id: 'c1', stage: 'staging'},
      {app: {id: 'app-2'}, id: 'c2', stage: 'production'},
    ]
    const apps = [
      {id: 'app-1', name: 'staging-app'},
      {id: 'app-2', name: 'prod-app'},
    ]

    const listByPipeline = vi.fn().mockResolvedValue(couplings)
    const ctx = ctxWithListByPipeline(listByPipeline)

    const post = vi.fn().mockResolvedValue(new Response(JSON.stringify(apps), {
      headers: {'content-type': 'application/json'},
      status: 200,
    }))
    vi.mocked(HerokuApiClient).mockImplementation(function (this: {post: typeof post}) {
      this.post = post
    } as never)

    const result = await listPipelineApps(ctx, 'pipeline-1', {clientOptions: {token: 'abc'}})

    expect(listByPipeline).toHaveBeenCalledWith('pipeline-1')
    expect(post).toHaveBeenCalledWith(
      '/filters/apps',
      {in: {id: ['app-1', 'app-2']}},
      {
        headers: {
          Accept: 'application/vnd.heroku+json; version=3.filters',
          Range: 'id ..; max=1000;',
        },
      },
    )
    expect(result).toEqual([
      {id: 'app-1', name: 'staging-app', pipelineCoupling: couplings[0]},
      {id: 'app-2', name: 'prod-app', pipelineCoupling: couplings[1]},
    ])
  })

  it('listPipelineApps returns an empty array when the pipeline has no couplings', async () => {
    const listByPipeline = vi.fn().mockResolvedValue([])
    const ctx = ctxWithListByPipeline(listByPipeline)
    const post = vi.fn()
    vi.mocked(HerokuApiClient).mockImplementation(function (this: {post: typeof post}) {
      this.post = post
    } as never)

    const result = await listPipelineApps(ctx, 'pipeline-empty')

    expect(result).toEqual([])
    expect(post).not.toHaveBeenCalled()
  })

  it('listPipelineApps honors an aborted signal before any work runs', async () => {
    const controller = new AbortController()
    controller.abort()

    const listByPipeline = vi.fn()
    const ctx = ctxWithListByPipeline(listByPipeline)

    await expect(listPipelineApps(ctx, 'pipeline-1', {signal: controller.signal})).rejects.toThrow()
    expect(listByPipeline).not.toHaveBeenCalled()
  })

  it('listPipelineApps skips couplings missing app.id', async () => {
    const couplings = [
      {app: {id: 'app-1'}, id: 'c1'},
      {id: 'c2'}, // no app
      {app: {}, id: 'c3'}, // app, no id
    ]
    const apps = [{id: 'app-1', name: 'app-one'}]

    const listByPipeline = vi.fn().mockResolvedValue(couplings)
    const ctx = ctxWithListByPipeline(listByPipeline)

    const post = vi.fn().mockResolvedValue(new Response(JSON.stringify(apps), {
      headers: {'content-type': 'application/json'},
      status: 200,
    }))
    vi.mocked(HerokuApiClient).mockImplementation(function (this: {post: typeof post}) {
      this.post = post
    } as never)

    const result = await listPipelineApps(ctx, 'pipeline-1')

    expect(post).toHaveBeenCalledWith(
      '/filters/apps',
      {in: {id: ['app-1']}},
      expect.anything(),
    )
    expect(result).toEqual([{id: 'app-1', name: 'app-one', pipelineCoupling: couplings[0]}])
  })

  it('listPipelineApps throws when over the apps filter limit and no onWarning is provided', async () => {
    const couplings = Array.from({length: 1001}, (_, i) => ({
      app: {id: `app-${i}`},
      id: `c-${i}`,
    }))

    const listByPipeline = vi.fn().mockResolvedValue(couplings)
    const ctx = ctxWithListByPipeline(listByPipeline)
    const post = vi.fn()
    vi.mocked(HerokuApiClient).mockImplementation(function (this: {post: typeof post}) {
      this.post = post
    } as never)

    await expect(listPipelineApps(ctx, 'pipeline-big')).rejects.toThrow(/more than 1000 apps/)
    expect(post).not.toHaveBeenCalled()
  })

  it('listPipelineApps truncates results and notifies onWarning when over the limit', async () => {
    const couplings = Array.from({length: 1500}, (_, i) => ({
      app: {id: `app-${i}`},
      id: `c-${i}`,
    }))
    const apps = Array.from({length: 1000}, (_, i) => ({id: `app-${i}`, name: `name-${i}`}))

    const listByPipeline = vi.fn().mockResolvedValue(couplings)
    const ctx = ctxWithListByPipeline(listByPipeline)

    const post = vi.fn().mockResolvedValue(new Response(JSON.stringify(apps), {
      headers: {'content-type': 'application/json'},
      status: 200,
    }))
    vi.mocked(HerokuApiClient).mockImplementation(function (this: {post: typeof post}) {
      this.post = post
    } as never)

    const onWarning = vi.fn()
    const result = await listPipelineApps(ctx, 'pipeline-big', {onWarning})

    expect(onWarning).toHaveBeenCalledWith({
      limit: 1000,
      pipelineId: 'pipeline-big',
      type: 'apps_truncated',
    })
    const postCall = post.mock.calls[0]
    expect(postCall[1].in.id).toHaveLength(1000)
    expect(result).toHaveLength(1000)
  })

  it('pipelineCouplingExtensions declares service: platform, resource: pipelineCoupling', () => {
    expect(pipelineCouplingExtensions.service).toBe('platform')
    expect(pipelineCouplingExtensions.resource).toBe('pipelineCoupling')
  })

  it('pipelineCouplingExtensions factory exposes a listApps method', () => {
    const ctx: ResourceCtx = {data: {} as never, platform: {} as never}
    const methods = pipelineCouplingExtensions.factory(ctx)
    expect(typeof methods.listApps).toBe('function')
  })
})
