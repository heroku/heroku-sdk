import type {Dyno} from '@heroku/types/3.sdk'

import {HerokuApiClient} from '@heroku/heroku-fetch'
import {
  afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest'

import {
  DynoCrashedError,
  enableExec,
  exchangeExecCredentials,
  execPrereqs,
  execStatus,
  restartForExec,
} from './exec.js'

vi.mock('@heroku/heroku-fetch', async () => {
  const actual = await vi.importActual<typeof import('@heroku/heroku-fetch')>('@heroku/heroku-fetch')
  return {
    ...actual,
    HerokuApiClient: vi.fn(),
  }
})

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    headers: {'content-type': 'application/json'},
    status,
  })
}

function basic(username: string, password: string): string {
  return `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`
}

/** Install a HerokuApiClient mock whose put/get delegate to the given fns. */
function mockClient(methods: {get?: ReturnType<typeof vi.fn>; put?: ReturnType<typeof vi.fn>}) {
  vi.mocked(HerokuApiClient).mockImplementation(function (this: Record<string, unknown>) {
    Object.assign(this, methods)
  } as never)
}

/** Build a partial-but-typed platform ctx; withOptions returns the same platform. */
function ctxWith(resources: Record<string, unknown>) {
  const platform = {...resources} as Record<string, unknown>
  platform.withOptions = vi.fn().mockReturnValue(platform)
  return {ctx: {platform: platform as never}, platform}
}

describe('execPrereqs', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('gathers app/buildpacks/config-vars/feature and shapes the raw facts', async () => {
    const appInfo = vi.fn().mockResolvedValue({
      build_stack: {name: 'heroku-24'},
      generation: 'cedar',
      space: {name: 'my-space', shield: true},
    })
    const buildpackList = vi.fn().mockResolvedValue([{buildpack: {url: 'urn:buildpack:heroku/exec'}, ordinal: 0}])
    const configInfo = vi.fn().mockResolvedValue({FOO: 'bar'})
    const featureInfo = vi.fn().mockResolvedValue({enabled: true})
    const {ctx} = ctxWith({
      app: {info: appInfo},
      appFeature: {info: featureInfo},
      buildpackInstallation: {list: buildpackList},
      configVar: {infoForApp: configInfo},
    })

    const facts = await execPrereqs(ctx, 'app-1')

    expect(featureInfo).toHaveBeenCalledWith('app-1', 'runtime-heroku-exec')
    expect(facts).toEqual({
      buildStack: 'heroku-24',
      buildpacks: [{buildpack: {url: 'urn:buildpack:heroku/exec'}, ordinal: 0}],
      configVars: {FOO: 'bar'},
      featureEnabled: true,
      generation: 'cedar',
      space: {name: 'my-space', shield: true},
    })
  })

  it('reports featureEnabled false and tolerates a null space / missing build_stack name', async () => {
    const {ctx} = ctxWith({
      app: {info: vi.fn().mockResolvedValue({build_stack: {}, generation: 'cedar', space: null})},
      appFeature: {info: vi.fn().mockResolvedValue({enabled: false})},
      buildpackInstallation: {list: vi.fn().mockResolvedValue([])},
      configVar: {infoForApp: vi.fn().mockResolvedValue({})},
    })

    const facts = await execPrereqs(ctx, 'app-1')

    expect(facts.buildStack).toBeUndefined()
    expect(facts.featureEnabled).toBe(false)
    expect(facts.space).toBeNull()
  })

  it('scopes the platform client to the caller signal', async () => {
    const {ctx, platform} = ctxWith({
      app: {info: vi.fn().mockResolvedValue({build_stack: {}, generation: 'cedar', space: null})},
      appFeature: {info: vi.fn().mockResolvedValue({enabled: false})},
      buildpackInstallation: {list: vi.fn().mockResolvedValue([])},
      configVar: {infoForApp: vi.fn().mockResolvedValue({})},
    })
    const controller = new AbortController()

    await execPrereqs(ctx, 'app-1', {signal: controller.signal})

    expect(platform.withOptions).toHaveBeenCalledWith({signal: controller.signal})
  })

  it('throws immediately when the signal is already aborted', async () => {
    const appInfo = vi.fn()
    const {ctx} = ctxWith({
      app: {info: appInfo},
      appFeature: {info: vi.fn()},
      buildpackInstallation: {list: vi.fn()},
      configVar: {infoForApp: vi.fn()},
    })
    const controller = new AbortController()
    controller.abort()

    await expect(execPrereqs(ctx, 'app-1', {signal: controller.signal})).rejects.toThrow()
    expect(appInfo).not.toHaveBeenCalled()
  })
})

describe('enableExec', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('enables the runtime-heroku-exec feature', async () => {
    const update = vi.fn().mockResolvedValue({enabled: true})
    const {ctx} = ctxWith({appFeature: {update}})

    await enableExec(ctx, 'app-1')

    expect(update).toHaveBeenCalledWith('app-1', 'runtime-heroku-exec', {enabled: true})
  })

  it('throws immediately when the signal is already aborted', async () => {
    const update = vi.fn()
    const {ctx} = ctxWith({appFeature: {update}})
    const controller = new AbortController()
    controller.abort()

    await expect(enableExec(ctx, 'app-1', {signal: controller.signal})).rejects.toThrow()
    expect(update).not.toHaveBeenCalled()
  })
})

describe('restartForExec', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('restarts all dynos then resolves once the target dyno is up', async () => {
    const restartAll = vi.fn().mockResolvedValue(undefined)
    const info = vi.fn()
      .mockResolvedValueOnce({name: 'web.1', state: 'starting'} as Dyno)
      .mockResolvedValueOnce({name: 'web.1', state: 'up'} as Dyno)
    const {ctx} = ctxWith({dyno: {info, restartAll}})

    const result = await restartForExec(ctx, 'app-1', 'web.1', {delayMs: 0, settleMs: 0})

    expect(restartAll).toHaveBeenCalledWith('app-1')
    expect(result).toEqual({name: 'web.1', state: 'up'})
    expect(info).toHaveBeenCalledTimes(2)
  })

  it('throws DynoCrashedError immediately when the dyno crashes', async () => {
    const restartAll = vi.fn().mockResolvedValue(undefined)
    const info = vi.fn().mockResolvedValue({name: 'web.1', state: 'crashed'} as Dyno)
    const {ctx} = ctxWith({dyno: {info, restartAll}})

    await expect(restartForExec(ctx, 'app-1', 'web.1', {delayMs: 0, settleMs: 0}))
      .rejects.toBeInstanceOf(DynoCrashedError)
    expect(restartAll).toHaveBeenCalledOnce()
    expect(info).toHaveBeenCalledOnce()
  })

  it('throws immediately when the signal is already aborted', async () => {
    const restartAll = vi.fn()
    const {ctx} = ctxWith({dyno: {info: vi.fn(), restartAll}})
    const controller = new AbortController()
    controller.abort()

    await expect(restartForExec(ctx, 'app-1', 'web.1', {settleMs: 0, signal: controller.signal}))
      .rejects.toThrow()
    expect(restartAll).not.toHaveBeenCalled()
  })
})

describe('exchangeExecCredentials', () => {
  const OLD_ENV = process.env.HEROKU_EXEC_URL

  beforeEach(() => {
    vi.clearAllMocks()
    delete process.env.HEROKU_EXEC_URL
  })

  afterEach(() => {
    if (OLD_ENV === undefined) delete process.env.HEROKU_EXEC_URL
    else process.env.HEROKU_EXEC_URL = OLD_ENV
  })

  const creds = {
    client_user: 'u', dyno_ip: '10.0.0.1', proxy_public_key: 'ssh-rsa PROXY', tunnel_host: 't.heroku.com',
  }

  it('PUTs the client key to the default exec-manager with app:apiKey Basic auth', async () => {
    const put = vi.fn().mockResolvedValue(jsonResponse(creds))
    mockClient({put})

    const result = await exchangeExecCredentials('app-1', {
      apiKey: 'key-123', dyno: 'web.1', publicKey: 'ssh-rsa PUBKEY',
    })

    expect(HerokuApiClient).toHaveBeenCalledWith({
      baseUrl: 'https://exec-manager.heroku.com', service: 'custom', token: '',
    })
    expect(put).toHaveBeenCalledWith(
      '/api/v2/web.1',
      {client_key: 'ssh-rsa PUBKEY'},
      {
        headers: {Authorization: basic('app-1', 'key-123'), 'Content-Type': 'application/json'},
        signal: undefined,
      },
    )
    expect(result).toEqual(creds)
  })

  it('uses the embedded credentials and /api/v1 when HEROKU_EXEC_URL is a config var', async () => {
    const put = vi.fn().mockResolvedValue(jsonResponse(creds))
    mockClient({put})

    await exchangeExecCredentials('app-1', {
      apiKey: 'key-123',
      configVars: {HEROKU_EXEC_URL: 'https://user:pass@exec.example.com/'},
      dyno: 'web.1',
      publicKey: 'ssh-rsa PUBKEY',
    })

    expect(HerokuApiClient).toHaveBeenCalledWith({
      baseUrl: 'https://exec.example.com', service: 'custom', token: '',
    })
    expect(put).toHaveBeenCalledWith(
      '/api/v1/web.1',
      {client_key: 'ssh-rsa PUBKEY'},
      expect.objectContaining({headers: expect.objectContaining({Authorization: basic('user', 'pass')})}),
    )
  })

  it('honors the HEROKU_EXEC_URL host override from the environment', async () => {
    process.env.HEROKU_EXEC_URL = 'https://exec.internal.test/'
    const put = vi.fn().mockResolvedValue(jsonResponse(creds))
    mockClient({put})

    await exchangeExecCredentials('app-1', {apiKey: 'key-123', dyno: 'web.1', publicKey: 'ssh-rsa PUBKEY'})

    expect(HerokuApiClient).toHaveBeenCalledWith({
      baseUrl: 'https://exec.internal.test', service: 'custom', token: '',
    })
    expect(put).toHaveBeenCalledWith('/api/v2/web.1', expect.anything(), expect.anything())
  })

  it('forwards extra headers, encodes the dyno, and threads the signal', async () => {
    const put = vi.fn().mockResolvedValue(jsonResponse(creds))
    mockClient({put})
    const controller = new AbortController()

    await exchangeExecCredentials('app-1', {
      apiKey: 'key-123',
      dyno: 'web 1',
      headers: {'X-Trace': 'abc'},
      publicKey: 'ssh-rsa PUBKEY',
      signal: controller.signal,
    })

    expect(put).toHaveBeenCalledWith(
      '/api/v2/web%201',
      {client_key: 'ssh-rsa PUBKEY'},
      {
        headers: {
          Authorization: basic('app-1', 'key-123'), 'Content-Type': 'application/json', 'X-Trace': 'abc',
        },
        signal: controller.signal,
      },
    )
  })

  it('defensively parses a double-encoded JSON string body', async () => {
    const put = vi.fn().mockResolvedValue(jsonResponse(JSON.stringify(creds)))
    mockClient({put})

    const result = await exchangeExecCredentials('app-1', {
      apiKey: 'key-123', dyno: 'web.1', publicKey: 'ssh-rsa PUBKEY',
    })

    expect(result).toEqual(creds)
  })

  it('throws immediately when the signal is already aborted', async () => {
    const put = vi.fn()
    mockClient({put})
    const controller = new AbortController()
    controller.abort()

    await expect(exchangeExecCredentials('app-1', {
      apiKey: 'key-123', dyno: 'web.1', publicKey: 'ssh-rsa PUBKEY', signal: controller.signal,
    })).rejects.toThrow()
    expect(put).not.toHaveBeenCalled()
  })
})

describe('execStatus', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    delete process.env.HEROKU_EXEC_URL
  })

  it('GETs the exec-manager status endpoint (no dyno) and returns the reservations', async () => {
    const reservations = [{dyno_name: 'web.1'}, {dyno_name: 'worker.1'}]
    const get = vi.fn().mockResolvedValue(jsonResponse(reservations))
    mockClient({get})

    const result = await execStatus('app-1', {apiKey: 'key-123'})

    expect(get).toHaveBeenCalledWith(
      '/api/v2',
      {headers: {Authorization: basic('app-1', 'key-123')}, signal: undefined},
    )
    expect(result).toEqual(reservations)
  })

  it('throws immediately when the signal is already aborted', async () => {
    const get = vi.fn()
    mockClient({get})
    const controller = new AbortController()
    controller.abort()

    await expect(execStatus('app-1', {apiKey: 'key-123', signal: controller.signal})).rejects.toThrow()
    expect(get).not.toHaveBeenCalled()
  })
})
