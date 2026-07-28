/* eslint-disable camelcase */
import type {App} from '@heroku/types/3.sdk'

import {
  afterEach, describe, expect, it, vi,
} from 'vitest'

import type {ResourceCtx} from '../../../core/extend-resource.js'

import {NotAContainerAppError, removeProcessTypes} from './index.js'

type FakePlatform = {
  app: {
    info: ReturnType<typeof vi.fn>
  }
  formation: {
    update: ReturnType<typeof vi.fn>
  }
  withHeaders: ReturnType<typeof vi.fn>
  withOptions: ReturnType<typeof vi.fn>
}

function buildCtx(stubs: {
  appInfo?: ReturnType<typeof vi.fn>
  formationUpdate?: ReturnType<typeof vi.fn>
} = {}): ResourceCtx {
  const platform: FakePlatform = {
    app: {
      info: stubs.appInfo ?? vi.fn().mockResolvedValue({}),
    },
    formation: {
      update: stubs.formationUpdate ?? vi.fn().mockResolvedValue({}),
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

const NON_CONTAINER_APP: Partial<App> = {
  build_stack: {name: 'heroku-22'},
  id: 'app-1',
  name: 'my-app',
  stack: {id: 'stack-1', name: 'heroku-22'},
}

describe('removeProcessTypes', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  it('removes one process type', async () => {
    const ctx = buildCtx({
      appInfo: vi.fn().mockResolvedValue(CONTAINER_APP),
      formationUpdate: vi.fn().mockResolvedValue({
        quantity: 0,
        type: 'web',
      }),
    })

    const result = await removeProcessTypes(ctx, 'my-app', ['web'])

    expect(ctx.platform.app.info).toHaveBeenCalledWith('my-app')
    expect(ctx.platform.formation.update).toHaveBeenCalledWith('my-app', 'web', {docker_image: null})
    expect(ctx.platform.withHeaders).toHaveBeenCalledWith({Accept: 'application/vnd.heroku+json; version=3.docker-releases'})
    expect(result).toEqual([{quantity: 0, type: 'web'}])
  })

  it('removes multiple process types', async () => {
    const ctx = buildCtx({
      appInfo: vi.fn().mockResolvedValue(CONTAINER_APP),
      formationUpdate: vi.fn()
        .mockResolvedValueOnce({
          quantity: 0,
          type: 'web',
        })
        .mockResolvedValueOnce({
          quantity: 0,
          type: 'worker',
        }),
    })

    const result = await removeProcessTypes(ctx, 'my-app', ['web', 'worker'])

    expect(ctx.platform.app.info).toHaveBeenCalledWith('my-app')

    expect(ctx.platform.withHeaders).toHaveBeenCalledTimes(2)
    expect(ctx.platform.withHeaders).toHaveBeenCalledWith({
      Accept: 'application/vnd.heroku+json; version=3.docker-releases',
    })

    expect(ctx.platform.formation.update).toHaveBeenCalledTimes(2)
    expect(ctx.platform.formation.update).toHaveBeenCalledWith('my-app', 'web', {docker_image: null})
    expect(ctx.platform.formation.update).toHaveBeenCalledWith('my-app', 'worker', {docker_image: null})

    expect(result).toEqual([
      {quantity: 0, type: 'web'},
      {quantity: 0, type: 'worker'},
    ])
  })

  it('throws NotAContainerAppError when app is not a container app', async () => {
    const ctx = buildCtx({
      appInfo: vi.fn().mockResolvedValue(NON_CONTAINER_APP),
    })

    await expect(removeProcessTypes(ctx, 'my-app', ['web']))
      .rejects.toThrow(NotAContainerAppError)

    expect(ctx.platform.app.info).toHaveBeenCalledWith('my-app')
    expect(ctx.platform.formation.update).not.toHaveBeenCalled()
  })

  it('honors an aborted signal before fetching app info', async () => {
    const controller = new AbortController()

    const ctx = buildCtx({
      appInfo: vi.fn().mockResolvedValue(CONTAINER_APP),
      formationUpdate: vi.fn().mockResolvedValue({quantity: 0, type: 'web'}),
    })

    controller.abort()

    await expect(removeProcessTypes(ctx, 'my-app', ['web'], {signal: controller.signal}))
      .rejects.toThrow()
    expect(ctx.platform.app.info).not.toHaveBeenCalled()
  })
})
