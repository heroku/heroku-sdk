/* eslint-disable camelcase */
import type {App, Release} from '@heroku/types/3.sdk'

import {
  afterEach, describe, expect, it, vi,
} from 'vitest'

import type {ResourceCtx} from '../../../core/extend-resource.js'

import {NotAContainerAppError, releaseDockerImages} from './index.js'

type FakePlatform = {
  app: {
    info: ReturnType<typeof vi.fn>
  }
  formation: {
    batchUpdate: ReturnType<typeof vi.fn>
  }
  release: {
    list: ReturnType<typeof vi.fn>
  }
  withHeaders: ReturnType<typeof vi.fn>
  withOptions: ReturnType<typeof vi.fn>
}

function buildCtx(stubs: {
  appInfo?: ReturnType<typeof vi.fn>
  formationBatchUpdate?: ReturnType<typeof vi.fn>
  releaseList?: ReturnType<typeof vi.fn>
} = {}): ResourceCtx {
  const platform: FakePlatform = {
    app: {
      info: stubs.appInfo ?? vi.fn().mockResolvedValue({}),
    },
    formation: {
      batchUpdate: stubs.formationBatchUpdate ?? vi.fn().mockResolvedValue([]),
    },
    release: {
      list: stubs.releaseList ?? vi.fn().mockResolvedValue([]),
    },
    withHeaders: vi.fn(function (this: any) {
      return this
    }),
    withOptions: vi.fn(function (this: any) {
      return this
    }),
  }
  platform.withOptions.mockReturnValue(platform)
  platform.withHeaders.mockReturnValue(platform)

  return {
    data: {} as never,
    platform: platform as never,
  }
}

const CONTAINER_APP: Partial<App> = {
  build_stack: {name: 'heroku-22'},
  id: 'app-1',
  name: 'my-app',
  stack: {id: 'stack-1', name: 'container'},
}

describe('releaseDockerImages', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  it('releases images and returns the old and new releases', async () => {
    const oldRelease: Partial<Release> = {
      id: 'rel-old', output_stream_url: null, status: 'succeeded', version: 10,
    }
    const newRelease: Partial<Release> = {
      id: 'rel-new', output_stream_url: 'https://stream', status: 'pending', version: 11,
    }

    const ctx = buildCtx({
      appInfo: vi.fn().mockResolvedValue(CONTAINER_APP),
      releaseList: vi.fn()
        .mockResolvedValueOnce([oldRelease])
        .mockResolvedValueOnce([newRelease]),
    })

    const images = [
      {docker_image: 'sha256:abc123', type: 'web'},
      {docker_image: 'sha256:def456', type: 'worker'},
    ]

    const result = await releaseDockerImages(ctx, 'my-app', images)

    expect(ctx.platform.app.info).toHaveBeenCalledWith('my-app')
    expect(ctx.platform.withHeaders).toHaveBeenNthCalledWith(1, {Range: 'version ..; max=1, order=desc'})
    expect(ctx.platform.withHeaders).toHaveBeenNthCalledWith(2, {
      Accept: 'application/vnd.heroku+json; version=3.docker-releases',
    })
    expect(ctx.platform.withHeaders).toHaveBeenNthCalledWith(3, {Range: 'version ..; max=1, order=desc'})
    expect(ctx.platform.formation.batchUpdate).toHaveBeenCalledWith('my-app', {updates: images})
    expect(ctx.platform.release.list).toHaveBeenCalledTimes(2)
    expect(ctx.platform.release.list).toHaveBeenCalledWith('my-app')
    expect(result).toEqual({newRelease, oldRelease})
  })

  it('throws NotAContainerAppError when the app is not a container app', async () => {
    const ctx = buildCtx({
      appInfo: vi.fn().mockResolvedValue({
        build_stack: {name: 'heroku-22'},
        id: 'app-1',
        name: 'my-app',
        stack: {name: 'heroku-22'},
      }),
    })

    await expect(releaseDockerImages(ctx, 'my-app', [{docker_image: 'sha256:abc', type: 'web'}]))
      .rejects.toThrow(NotAContainerAppError)
    expect(ctx.platform.formation.batchUpdate).not.toHaveBeenCalled()
    expect(ctx.platform.release.list).not.toHaveBeenCalled()
  })

  it('honors an aborted signal before fetching app info', async () => {
    const controller = new AbortController()
    controller.abort()

    const ctx = buildCtx({
      appInfo: vi.fn().mockResolvedValue(CONTAINER_APP),
    })

    await expect(releaseDockerImages(ctx, 'my-app', [{docker_image: 'sha256:abc', type: 'web'}], {signal: controller.signal}))
      .rejects.toThrow()
    expect(ctx.platform.app.info).not.toHaveBeenCalled()
  })
})
