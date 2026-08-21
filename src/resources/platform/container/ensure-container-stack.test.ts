/* eslint-disable camelcase */
import {App} from '@heroku/types/3.sdk'
import {
  afterEach, describe, expect, it, vi,
} from 'vitest'

import type {ResourceCtx} from '../../../core/extend-resource.js'

import {ensureContainerStack, NotAContainerAppError} from './index.js'

type FakePlatform = {
  app: {
    info: ReturnType<typeof vi.fn>
  }
  withOptions: ReturnType<typeof vi.fn>
}

function buildCtx(stubs: {
  appInfo?: ReturnType<typeof vi.fn>
} = {}): ResourceCtx {
  const platform: FakePlatform = {
    app: {
      info: stubs.appInfo ?? vi.fn().mockResolvedValue({}),
    },
    withOptions: vi.fn(function (this: any) {
      return this
    }),
  }
  platform.withOptions.mockReturnValue(platform)

  return {
    data: {} as never,
    metrics: {} as never,
    platform: platform as never,
    repositories: {} as never,
  }
}

describe('ensureContainerStack', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  it('resolves when the app stack is container', async () => {
    const app: Partial<App> = {
      build_stack: {name: 'heroku-22'},
      id: 'app-1',
      name: 'my-app',
      stack: {id: 'stack-1', name: 'container'},
    }
    const ctx = buildCtx({
      appInfo: vi.fn().mockResolvedValue(app),
    })

    await expect(ensureContainerStack(ctx, 'my-app')).resolves.toBeUndefined()
    expect(ctx.platform.app.info).toHaveBeenCalledWith('my-app')
  })

  it('resolves when the build_stack is container', async () => {
    const app: Partial<App> = {
      build_stack: {name: 'container'},
      id: 'app-1',
      name: 'my-app',
      stack: {id: 'stack-1', name: 'heroku-22'},
    }
    const ctx = buildCtx({
      appInfo: vi.fn().mockResolvedValue(app),
    })

    await expect(ensureContainerStack(ctx, 'my-app')).resolves.toBeUndefined()
    expect(ctx.platform.app.info).toHaveBeenCalledWith('my-app')
  })

  it('throws NotAContainerAppError when neither stack nor build_stack is container', async () => {
    const app: Partial<App> = {
      build_stack: {name: 'heroku-22'},
      id: 'app-1',
      name: 'my-app',
      stack: {id: 'stack-1', name: 'heroku-22'},
    }

    const ctx = buildCtx({
      appInfo: vi.fn().mockResolvedValue(app),
    })

    try {
      await ensureContainerStack(ctx, 'my-app')
      expect.fail('Expected NotAContainerAppError to be thrown')
    } catch (error) {
      expect(error).toBeInstanceOf(NotAContainerAppError)

      const e = error as NotAContainerAppError

      expect(e.name).toBe('NotAContainerAppError')
      expect(e.id).toBe('not_a_container_app')
      expect(e.app).toEqual(app)
      expect(e.message).toBe('This operation is for Docker apps only.')
    }
  })

  it('honors an aborted signal before fetching app info', async () => {
    const controller = new AbortController()
    controller.abort()

    const app: Partial<App> = {
      build_stack: {name: 'heroku-22'},
      id: 'app-1',
      name: 'my-app',
      stack: {id: 'stack-1', name: 'container'},
    }
    const ctx = buildCtx({
      appInfo: vi.fn().mockResolvedValue(app),
    })

    await expect(ensureContainerStack(ctx, 'my-app', {signal: controller.signal}))
      .rejects.toThrow()
    expect(ctx.platform.app.info).not.toHaveBeenCalled()
  })
})
