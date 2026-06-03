import type {
  AddOn, App, Collaborator, Dyno,
} from '@heroku/types/3.sdk'

import {
  describe, expect, it, vi,
} from 'vitest'

import type {ResourceCtx} from '../../../core/extend-resource.js'

import {
  appExtensions, describeApp, type PipelineCouplingDetail,
} from './index.js'

type FakePlatform = {
  addOn: {listByApp: ReturnType<typeof vi.fn>}
  app: {info: ReturnType<typeof vi.fn>}
  collaborator: {list: ReturnType<typeof vi.fn>}
  dyno: {list: ReturnType<typeof vi.fn>}
  pipelineCoupling: {infoByApp: ReturnType<typeof vi.fn>}
  withOptions: ReturnType<typeof vi.fn>
}

function buildCtx(stubs: {
  addOnListByApp?: ReturnType<typeof vi.fn>
  appInfo?: ReturnType<typeof vi.fn>
  collaboratorList?: ReturnType<typeof vi.fn>
  dynoList?: ReturnType<typeof vi.fn>
  pipelineCouplingInfoByApp?: ReturnType<typeof vi.fn>
} = {}): {ctx: ResourceCtx; platform: FakePlatform} {
  const platform: FakePlatform = {
    addOn: {listByApp: stubs.addOnListByApp ?? vi.fn().mockResolvedValue([])},
    app: {info: stubs.appInfo ?? vi.fn().mockResolvedValue({})},
    collaborator: {list: stubs.collaboratorList ?? vi.fn().mockResolvedValue([])},
    dyno: {list: stubs.dynoList ?? vi.fn().mockResolvedValue([])},
    pipelineCoupling: {infoByApp: stubs.pipelineCouplingInfoByApp ?? vi.fn().mockResolvedValue(null)},
    withOptions: vi.fn(),
  }
  platform.withOptions.mockReturnValue(platform)

  return {
    ctx: {data: {} as never, platform: platform as never},
    platform,
  }
}

describe('describeApp', () => {
  it('returns the parallel composite of addons, app, dynos, collaborators, and pipelineCoupling', async () => {
    const addons = [{id: 'addon-1', name: 'pg'} as AddOn]
    const app = {id: 'app-1', name: 'my-app'} as App
    const dynos = [{id: 'dyno-1', type: 'web'} as Dyno]
    const collaborators = [{user: {email: 'a@b.com'}} as Collaborator]
    const pipelineCoupling = {
      id: 'coupling-1',
      pipeline: {id: 'p-1', name: 'my-pipeline'},
      stage: 'production' as const,
    } as PipelineCouplingDetail

    const {ctx, platform} = buildCtx({
      addOnListByApp: vi.fn().mockResolvedValue(addons),
      appInfo: vi.fn().mockResolvedValue(app),
      collaboratorList: vi.fn().mockResolvedValue(collaborators),
      dynoList: vi.fn().mockResolvedValue(dynos),
      pipelineCouplingInfoByApp: vi.fn().mockResolvedValue(pipelineCoupling),
    })

    const result = await describeApp(ctx, 'my-app')

    expect(result).toEqual({
      addons, app, collaborators, dynos, pipelineCoupling,
    })
    expect(platform.addOn.listByApp).toHaveBeenCalledExactlyOnceWith('my-app')
    expect(platform.app.info).toHaveBeenCalledExactlyOnceWith('my-app')
    expect(platform.dyno.list).toHaveBeenCalledExactlyOnceWith('my-app')
    expect(platform.collaborator.list).toHaveBeenCalledExactlyOnceWith('my-app')
    expect(platform.pipelineCoupling.infoByApp).toHaveBeenCalledExactlyOnceWith('my-app')
  })

  it('returns empty dynos when dyno.list rejects', async () => {
    const {ctx} = buildCtx({
      dynoList: vi.fn().mockRejectedValue(new Error('boom')),
    })

    const result = await describeApp(ctx, 'my-app')

    expect(result.dynos).toEqual([])
  })

  it('returns empty collaborators when collaborator.list rejects', async () => {
    const {ctx} = buildCtx({
      collaboratorList: vi.fn().mockRejectedValue(new Error('boom')),
    })

    const result = await describeApp(ctx, 'my-app')

    expect(result.collaborators).toEqual([])
  })

  it('returns null pipelineCoupling when pipelineCoupling.infoByApp rejects', async () => {
    const {ctx} = buildCtx({
      pipelineCouplingInfoByApp: vi.fn().mockRejectedValue(new Error('boom')),
    })

    const result = await describeApp(ctx, 'my-app')

    expect(result.pipelineCoupling).toBeNull()
  })

  it('propagates an error from addOn.listByApp', async () => {
    const {ctx} = buildCtx({
      addOnListByApp: vi.fn().mockRejectedValue(new Error('addon-boom')),
    })

    await expect(describeApp(ctx, 'my-app')).rejects.toThrow('addon-boom')
  })

  it('propagates an error from app.info', async () => {
    const {ctx} = buildCtx({
      appInfo: vi.fn().mockRejectedValue(new Error('app-boom')),
    })

    await expect(describeApp(ctx, 'my-app')).rejects.toThrow('app-boom')
  })

  it('throws if the abort signal is already aborted, without calling any route', async () => {
    const {ctx, platform} = buildCtx()
    const controller = new AbortController()
    controller.abort()

    await expect(describeApp(ctx, 'my-app', {signal: controller.signal})).rejects.toThrow()
    expect(platform.addOn.listByApp).not.toHaveBeenCalled()
    expect(platform.app.info).not.toHaveBeenCalled()
    expect(platform.dyno.list).not.toHaveBeenCalled()
    expect(platform.collaborator.list).not.toHaveBeenCalled()
    expect(platform.pipelineCoupling.infoByApp).not.toHaveBeenCalled()
  })

  it('threads the signal through withOptions when provided', async () => {
    const {ctx, platform} = buildCtx()
    const controller = new AbortController()

    await describeApp(ctx, 'my-app', {signal: controller.signal})

    expect(platform.withOptions).toHaveBeenCalledExactlyOnceWith({signal: controller.signal})
  })

  it('does not call withOptions when no signal is provided', async () => {
    const {ctx, platform} = buildCtx()

    await describeApp(ctx, 'my-app')

    expect(platform.withOptions).not.toHaveBeenCalled()
  })
})

describe('appExtensions.describe wiring', () => {
  it('exposes a describe method that delegates to describeApp', async () => {
    const {ctx, platform} = buildCtx({
      appInfo: vi.fn().mockResolvedValue({id: 'app-1'} as App),
    })
    const methods = appExtensions.factory(ctx)

    expect(typeof methods.describe).toBe('function')
    const result = await methods.describe('my-app')
    expect(result.app).toEqual({id: 'app-1'})
    expect(platform.app.info).toHaveBeenCalledExactlyOnceWith('my-app')
  })
})
