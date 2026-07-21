import type {Dyno} from '@heroku/types/3.sdk'

import {HerokuApiClient, HerokuApiError} from '@heroku/heroku-fetch'
import {
  beforeEach, describe, expect, it, vi,
} from 'vitest'

import type {ResourceCtx} from '../../../core/extend-resource.js'

import {runDyno} from './run.js'

vi.mock('@heroku/heroku-fetch', async () => {
  const actual = await vi.importActual<typeof import('@heroku/heroku-fetch')>('@heroku/heroku-fetch')
  return {
    ...actual,
    HerokuApiClient: vi.fn(),
  }
})

const DYNO: Dyno = {name: 'run.1234', state: 'starting'} as Dyno

function ctxWith(create: ReturnType<typeof vi.fn>): ResourceCtx {
  const platform = {dyno: {create}} as Record<string, unknown>
  platform.withOptions = vi.fn().mockReturnValue(platform)
  return {data: {} as never, platform: platform as never}
}

function mockPost(post: ReturnType<typeof vi.fn>) {
  vi.mocked(HerokuApiClient).mockImplementation(function (this: {post: typeof post}) {
    this.post = post
  } as never)
}

function jsonResponse(body: unknown, status = 201): Response {
  return new Response(JSON.stringify(body), {
    headers: {'content-type': 'application/json'},
    status,
  })
}

describe('runDyno', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('creates a one-off dyno via dyno.create', async () => {
    const create = vi.fn().mockResolvedValue(DYNO)
    const ctx = ctxWith(create)

    const result = await runDyno(ctx, 'app-1', 'bash')

    expect(create).toHaveBeenCalledExactlyOnceWith('app-1', {command: 'bash'})
    expect(HerokuApiClient).not.toHaveBeenCalled()
    expect(result).toBe(DYNO)
  })

  it('forwards optional fields into the create body, converting forceNoTTY to force_no_tty', async () => {
    const create = vi.fn().mockResolvedValue(DYNO)
    const ctx = ctxWith(create)

    await runDyno(ctx, 'app-1', 'rails console', {
      attach: true,
      env: {FOO: 'bar'},
      forceNoTTY: true,
      size: 'Standard-1X',
      type: 'run',
    })

    expect(create).toHaveBeenCalledWith('app-1', {
      attach: true,
      command: 'rails console',
      env: {FOO: 'bar'},
      // eslint-disable-next-line camelcase -- platform wire format
      force_no_tty: true,
      size: 'Standard-1X',
      type: 'run',
    })
  })

  it('wraps the command with an exit-status echo when exitCode is set', async () => {
    const create = vi.fn().mockResolvedValue(DYNO)
    const ctx = ctxWith(create)

    await runDyno(ctx, 'app-1', 'rake db:migrate', {exitCode: true})

    expect(create).toHaveBeenCalledWith('app-1', {
      command: 'rake db:migrate; echo "￿ heroku-command-exit-status: $?"',
    })
  })

  it('wraps the command with an exit-status echo on the exec-inside path too', async () => {
    const ctx = ctxWith(vi.fn())
    const post = vi.fn().mockResolvedValue(jsonResponse(DYNO))
    mockPost(post)

    await runDyno(ctx, 'app-1', 'rake db:migrate', {dyno: 'web.1', exitCode: true})

    expect(post).toHaveBeenCalledWith(
      '/apps/app-1/dynos/web.1',
      {command: 'rake db:migrate; echo "￿ heroku-command-exit-status: $?"'},
      expect.anything(),
    )
  })

  it('forwards attach: false explicitly into the create body', async () => {
    const create = vi.fn().mockResolvedValue(DYNO)
    const ctx = ctxWith(create)

    await runDyno(ctx, 'app-1', 'bash', {attach: false})

    expect(create).toHaveBeenCalledWith('app-1', {attach: false, command: 'bash'})
  })

  it('scopes the platform client to the caller signal', async () => {
    const create = vi.fn().mockResolvedValue(DYNO)
    const ctx = ctxWith(create)
    const controller = new AbortController()

    await runDyno(ctx, 'app-1', 'bash', {signal: controller.signal})

    expect(ctx.platform.withOptions).toHaveBeenCalledWith({signal: controller.signal})
  })

  it('throws immediately when the signal is already aborted', async () => {
    const create = vi.fn()
    const ctx = ctxWith(create)
    const controller = new AbortController()
    controller.abort()

    await expect(runDyno(ctx, 'app-1', 'bash', {signal: controller.signal})).rejects.toThrow()
    expect(create).not.toHaveBeenCalled()
  })

  it('execs inside an existing dyno via a raw HerokuApiClient with the version=3.sdk Accept', async () => {
    const create = vi.fn()
    const ctx = ctxWith(create)
    const post = vi.fn().mockResolvedValue(jsonResponse(DYNO))
    mockPost(post)

    const result = await runDyno(ctx, 'app-1', 'bash', {dyno: 'web.1'})

    expect(create).not.toHaveBeenCalled()
    expect(HerokuApiClient).toHaveBeenCalledExactlyOnceWith({service: 'platform'})
    expect(post).toHaveBeenCalledExactlyOnceWith(
      '/apps/app-1/dynos/web.1',
      {command: 'bash'},
      {
        headers: {Accept: 'application/vnd.heroku+json; version=3.sdk'},
        signal: undefined,
      },
    )
    expect(result).toEqual(DYNO)
  })

  it('percent-encodes appIdentity and dyno name in the exec-inside path', async () => {
    const create = vi.fn()
    const ctx = ctxWith(create)
    const post = vi.fn().mockResolvedValue(jsonResponse(DYNO))
    mockPost(post)

    await runDyno(ctx, 'app with spaces', 'bash', {dyno: 'web/1'})

    expect(post).toHaveBeenCalledWith(
      '/apps/app%20with%20spaces/dynos/web%2F1',
      expect.anything(),
      expect.anything(),
    )
  })

  it('forwards clientOptions to the raw HerokuApiClient (exec-inside)', async () => {
    const ctx = ctxWith(vi.fn())
    const post = vi.fn().mockResolvedValue(jsonResponse(DYNO))
    mockPost(post)

    await runDyno(ctx, 'app-1', 'bash', {
      clientOptions: {token: 'abc'},
      dyno: 'web.1',
    })

    expect(HerokuApiClient).toHaveBeenCalledWith({service: 'platform', token: 'abc'})
  })

  it('retries once on a 409 from dyno.create and returns the second response', async () => {
    const conflict = new HerokuApiError('release not found', 409)
    const create = vi.fn()
      .mockRejectedValueOnce(conflict)
      .mockResolvedValueOnce(DYNO)
    const ctx = ctxWith(create)

    const result = await runDyno(ctx, 'app-1', 'bash')

    expect(create).toHaveBeenCalledTimes(2)
    expect(result).toBe(DYNO)
  })

  it('gives up after three consecutive 409s and rethrows the last one', async () => {
    const first = new HerokuApiError('release not found', 409)
    const second = new HerokuApiError('release not found', 409)
    const third = new HerokuApiError('release not found', 409)
    const create = vi.fn()
      .mockRejectedValueOnce(first)
      .mockRejectedValueOnce(second)
      .mockRejectedValueOnce(third)
    const ctx = ctxWith(create)

    await expect(runDyno(ctx, 'app-1', 'bash')).rejects.toBe(third)
    expect(create).toHaveBeenCalledTimes(3)
  })

  it('retries a 409 on the exec-inside path as well', async () => {
    const ctx = ctxWith(vi.fn())
    const post = vi.fn()
      .mockRejectedValueOnce(new HerokuApiError('release not found', 409))
      .mockResolvedValueOnce(jsonResponse(DYNO))
    mockPost(post)

    const result = await runDyno(ctx, 'app-1', 'bash', {dyno: 'web.1'})

    expect(post).toHaveBeenCalledTimes(2)
    expect(result).toEqual(DYNO)
  })

  it('does not retry non-409 errors', async () => {
    const forbidden = new HerokuApiError('Forbidden', 403)
    const create = vi.fn().mockRejectedValueOnce(forbidden)
    const ctx = ctxWith(create)

    await expect(runDyno(ctx, 'app-1', 'bash')).rejects.toBe(forbidden)
    expect(create).toHaveBeenCalledTimes(1)
  })
})
