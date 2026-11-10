/* eslint-disable camelcase */
import {
  afterEach, describe, expect, it, vi,
} from 'vitest'

import type {ResourceCtx} from '../../core/extend-resource.js'

import {legacyResourceCtx} from '../../../test-types/heroku-sdk-options.js'
import {mergeExtensions} from '../../core/extensions-proxy.js'
import {DatabaseCopyTransferError as PublicDatabaseCopyTransferError} from '../extensions/data.js'
import {copyDatabase, databaseCopyExtensions, DatabaseCopyTransferError} from './database-copy.js'
import {transferExtensions, TransferFailedError, TransferTimeoutError} from './transfer/wait-for-transfer.js'

const neverSettles = () => new Promise<void>(() => {})

const pgAttachment = {
  addon: {
    app: {id: 'app-1-id', name: 'app-1'},
    id: 'addon-1',
    name: 'postgres-1',
    plan: {name: 'heroku-postgresql:standard-0'},
  },
  app: {id: 'app-1-id', name: 'app-1'},
  config_vars: ['DATABASE_URL'],
  id: 'attachment-1',
  name: 'DATABASE',
}

function buildCtx(opts: {
  credentials?: ReturnType<typeof vi.fn>
  infoByApp?: ReturnType<typeof vi.fn>
  makeClient?: ReturnType<typeof vi.fn>
  onSignal?: (signal?: AbortSignal) => void
  operationSignal?: AbortSignal
  resolution?: ReturnType<typeof vi.fn>
  transferCreate?: ReturnType<typeof vi.fn>
} = {}): ResourceCtx {
  let requestSignal = opts.operationSignal
  const infoByApp = opts.infoByApp ?? vi.fn().mockResolvedValue({finished_at: 'now', succeeded: true, uuid: 'transfer-1'})
  const transfer = {
    create: opts.transferCreate ?? vi.fn().mockResolvedValue({uuid: 'transfer-1'}),
    infoByApp: opts.onSignal
      ? new Proxy(infoByApp, {
        apply(target, thisArg, args: unknown[]) {
          return Reflect.apply(target, thisArg, [...args, ...(requestSignal ? [requestSignal] : [])])
        },
      })
      : infoByApp,
  }
  const data: Record<string, unknown> = {
    postgresDatabase: {
      listCredentials: opts.credentials ?? vi.fn().mockResolvedValue([{user: 'default'}, {user: 'extra'}]),
    },
    transfer,
  }
  data.withOptions = vi.fn((options?: {signal?: AbortSignal}) => {
    if (options?.signal !== undefined) requestSignal = options.signal
    opts.onSignal?.(requestSignal)
    return data
  })

  return {
    ...legacyResourceCtx,
    data: data as never,
    operationSignal: opts.operationSignal,
    ...(opts.makeClient ? {makeClient: opts.makeClient as never} : {}),
    platform: {
      addOnAttachment: {resolution: opts.resolution ?? vi.fn().mockResolvedValue([pgAttachment])},
      configVar: {infoForApp: vi.fn().mockResolvedValue({DATABASE_URL: 'postgres://heroku/database'})},
      withHeaders() {
        return this
      },
      withOptions() {
        return this
      },
    } as never,
  }
}

function buildSdkDataClient(ctx: ResourceCtx) {
  const makeRoutes = (): Record<string, unknown> => ({
    database: {},
    transfer: {},
    withOptions: vi.fn().mockImplementation(makeRoutes),
  })

  return mergeExtensions(makeRoutes(), [databaseCopyExtensions, transferExtensions], ctx) as {
    database: {copy: typeof copyDatabase}
    withOptions: (options: {signal?: AbortSignal}) => ReturnType<typeof buildSdkDataClient>
  }
}

describe('database copy resource', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  it('redacts URL credential components from abort reasons after beforeCopy without creating a transfer', async () => {
    class CopyAbortReason extends Error {
      public readonly metadata = {
        url: 'postgres://user%40name:p%40ss%2Fword@other.example/db?token=tok%2Ben',
      }
    }

    const controller = new AbortController()
    const sourceUrl = 'postgres://source-user:source-secret@source.example/db?token=source-token'
    const targetUrl = 'postgres://target-user:target-secret@target.example/db?password=target%2Btoken'
    const reason = new CopyAbortReason(`stop ${sourceUrl} and ${targetUrl}`)
    const ctx = buildCtx()
    const {configVar} = ctx.platform as never as {configVar: {infoForApp: ReturnType<typeof vi.fn>}}
    configVar.infoForApp.mockResolvedValue({DATABASE_URL: sourceUrl})
    const beforeCopy = vi.fn(() => controller.abort(reason))
    const error = await copyDatabase(ctx, 'app-1', 'DATABASE_URL', targetUrl, {
      beforeCopy,
      signal: controller.signal,
    }).catch((error_: unknown) => error_)

    expect(error).toBeInstanceOf(CopyAbortReason)
    expect(error).not.toBe(reason)
    expect((error as Error).name).toBe('Error')
    expect((error as Error).message).toContain('postgres://[REDACTED]')
    expect(JSON.stringify(error)).not.toMatch(/source-user|source-secret|source-token|target-user|target-secret|target\+token/)
    expect(beforeCopy).toHaveBeenCalledOnce()
    expect((ctx.data as never as {transfer: {create: ReturnType<typeof vi.fn>}}).transfer.create).not.toHaveBeenCalled()
  })

  it('preserves resolver error prototype and custom fields while sanitizing nested URLs', async () => {
    class ResolverError extends Error {
      public readonly details = {
        password: 'resolver-pass',
        request: 'https://resolver-user:resolver-pass@resolver.example/path?access_token=resolver-token',
        token: 'resolver-token',
        username: 'resolver-user',
      }
      public override readonly name = 'ResolverError https://resolver-user:resolver-pass@resolver.example/path?access_token=resolver-token'
    }

    const resolverError = new ResolverError('Could not resolve https://resolver-user:resolver-pass@resolver.example/path?access_token=resolver-token')
    const ctx = buildCtx({resolution: vi.fn().mockRejectedValue(resolverError)})
    const error = await copyDatabase(ctx, 'app-1', 'DATABASE_URL', 'postgres://target.example/db')
      .catch((error_: unknown) => error_)

    expect(error).toBeInstanceOf(ResolverError)
    expect(error).not.toBe(resolverError)
    expect((error as Error).name).toBe('ResolverError https://[REDACTED]')
    expect((error as ResolverError).details.request).toBe('https://[REDACTED]')
    expect((error as ResolverError).details.password).toBe('REDACTED')
    expect((error as ResolverError).details.token).toBe('REDACTED')
    expect((error as ResolverError).details.username).toBe('REDACTED')
    expect(JSON.stringify(error)).not.toMatch(/resolver-user|resolver-pass|resolver-token/)
  })

  it('redacts sensitive fields and query parameters in credential lookup errors', async () => {
    const sourceUrl = 'postgres://source.example/db?user=alice&password=source-secret'
    const token = 'legacy-secret-token'
    const basicAuthorization = `Basic ${Buffer.from(`:${token}`).toString('base64')}`
    const lookupError = Object.assign(
      new Error(`lookup failed for ${sourceUrl}; token=${token}; ${basicAuthorization}`),
      {metadata: {password: 'nested-pass', username: 'nested-user'}},
    )
    const credentialGet = vi.fn().mockRejectedValue(lookupError)
    const makeClient = vi.fn().mockReturnValue({get: credentialGet})
    let finishTransfer!: (transfer: {finished_at: string; succeeded: boolean; uuid: string}) => void
    const transferOutcome = new Promise<{finished_at: string; succeeded: boolean; uuid: string}>(resolve => {
      finishTransfer = resolve
    })
    const infoByApp = vi.fn(() => transferOutcome)
    const ctx = buildCtx({infoByApp, makeClient})
    const {configVar} = ctx.platform as never as {configVar: {infoForApp: ReturnType<typeof vi.fn>}}
    configVar.infoForApp.mockResolvedValue({DATABASE_URL: sourceUrl})

    const pendingCopy = copyDatabase(ctx, 'app-1', 'DATABASE_URL', 'postgres://target.example/db', {credentialToken: token})
    await vi.waitFor(() => expect(credentialGet).toHaveBeenCalledOnce())
    await Promise.resolve()
    await Promise.resolve()
    finishTransfer({finished_at: 'now', succeeded: true, uuid: 'transfer-1'})
    const error = await pendingCopy.catch((error_: unknown) => error_)
    const serialized = JSON.stringify(error)

    expect((error as Error & {cause?: Error & {metadata: {password: string; username: string}}}).cause?.metadata)
      .toEqual({password: 'REDACTED', username: 'REDACTED'})
    expect(serialized).not.toMatch(/alice|source-secret|nested-pass|nested-user|legacy-secret-token/)
    expect(serialized).not.toContain(basicAuthorization)
    expect(serialized).not.toContain(Buffer.from(`:${token}`).toString('base64'))
    expect((error as Error).message).toContain('postgres://[REDACTED]')
  })

  it('resolves raw URLs and a Heroku config-var identity, creates the typed transfer, and waits', async () => {
    const order: string[] = []
    const transferCreate = vi.fn().mockImplementation(async (...args: unknown[]) => {
      order.push('create')
      return {uuid: 'transfer-1', ...args}
    })
    const credentials = vi.fn()
    const infoByApp = vi.fn().mockImplementation(async () => {
      order.push('poll')
      return {finished_at: 'now', succeeded: true, uuid: 'transfer-1'}
    })
    const ctx = buildCtx({credentials, infoByApp, transferCreate})
    const onPoll = vi.fn()
    const copyPoller = {onStart: vi.fn(), onStop: vi.fn()}
    const waitPoller = {onStart: vi.fn(), onStop: vi.fn()}

    const result = await copyDatabase(ctx, 'app-1', 'postgres://source.example/db', 'DATABASE_URL', {
      copyPoller,
      intervalMs: 15,
      onPoll,
      waitPoller,
    })

    expect(transferCreate).toHaveBeenCalledWith('addon-1', {
      from_name: 'database db on source.example:5432',
      from_url: 'postgres://source.example/db',
      to_name: 'DATABASE',
      to_url: 'postgres://heroku/database',
    })
    expect(order).toEqual(['create', 'poll'])
    expect(credentials).not.toHaveBeenCalled()
    expect(infoByApp).toHaveBeenCalledWith('app-1', 'transfer-1', {verbose: undefined})
    expect(onPoll).toHaveBeenCalledWith({finished_at: 'now', succeeded: true, uuid: 'transfer-1'})
    expect(copyPoller.onStart).toHaveBeenCalledOnce()
    expect(copyPoller.onStop).toHaveBeenCalledOnce()
    expect(waitPoller.onStart).toHaveBeenCalledWith(expect.objectContaining({uuid: 'transfer-1'}))
    expect(waitPoller.onStop).toHaveBeenCalledWith(expect.objectContaining({uuid: 'transfer-1'}))
    expect(result).toEqual(expect.objectContaining({
      credentialCount: undefined,
      hasAdditionalCredentials: false,
      transfer: {finished_at: 'now', succeeded: true, uuid: 'transfer-1'},
    }))
  })

  it.each([
    ['attachment', 'DATABASE', 'default-app'],
    ['config-var', 'DATABASE_URL', 'default-app'],
    ['globally unique add-on name', 'postgres-1', 'default-app'],
    ['app::identity', 'default-app::DATABASE_URL', 'default-app'],
  ])('resolves %s inputs through the attachment resolver', async (_label, identity, expectedApp) => {
    const resolution = vi.fn().mockResolvedValue([pgAttachment])
    const ctx = buildCtx({resolution})

    await copyDatabase(ctx, 'default-app', identity, 'postgres://target.example/db')

    expect(resolution).toHaveBeenCalledWith({addon_attachment: identity.includes('::') ? 'DATABASE_URL' : identity, app: expectedApp})
  })

  it('uses the app qualifier when resolving app::attachment identities', async () => {
    const scopedAttachment = {
      ...pgAttachment,
      addon: {...pgAttachment.addon, app: {id: 'other-app-id', name: 'other-app'}},
      app: {id: 'other-app-id', name: 'other-app'},
    }
    const resolution = vi.fn().mockResolvedValue([scopedAttachment])
    const ctx = buildCtx({resolution})

    const result = await copyDatabase(ctx, 'default-app', 'other-app::DATABASE_URL', 'postgres://target.example/db')

    expect(resolution).toHaveBeenCalledWith({addon_attachment: 'DATABASE_URL', app: 'other-app'})
    expect(result.source).not.toHaveProperty('url')
  })

  it('resolves config-var values case-insensitively using the attachment URL config var', async () => {
    const ctx = buildCtx();
    (ctx.platform as never as {configVar: {infoForApp: ReturnType<typeof vi.fn>}}).configVar.infoForApp
      .mockResolvedValue({database_url: 'postgres://heroku/lowercase'})

    const result = await copyDatabase(ctx, 'app-1', 'DATABASE_URL', 'postgres://target.example/db')

    expect(result.source).not.toHaveProperty('url')
  })

  it('selects the first attachment config var that contains a Postgres URL when the default name is missing', async () => {
    const attachment = {
      ...pgAttachment,
      config_vars: ['DATABASE_URL', 'OLD_DATABASE_URL'],
      name: 'RENAMED_DATABASE',
    }
    const resolution = vi.fn().mockResolvedValue([attachment])
    const ctx = buildCtx({resolution})
    const {infoForApp} = (ctx.platform as never as {configVar: {infoForApp: ReturnType<typeof vi.fn>}}).configVar
    infoForApp.mockResolvedValue({DATABASE_URL: 'postgres://heroku/default', OLD_DATABASE_URL: 'postgres://heroku/old'})

    const result = await copyDatabase(ctx, 'app-1', 'RENAMED_DATABASE', 'postgres://target.example/db')

    expect(result.source).not.toHaveProperty('url')
  })

  it('rejects identical URLs before transfer creation', async () => {
    const ctx = buildCtx()

    await expect(copyDatabase(ctx, 'app-1', 'postgres://same.example/db', 'postgres://same.example/db'))
      .rejects.toThrow('Cannot copy database onto itself')
    expect((ctx.data as never as {transfer: {create: ReturnType<typeof vi.fn>}}).transfer.create).not.toHaveBeenCalled()
  })

  it('rejects two external URLs before transfer creation', async () => {
    const ctx = buildCtx()

    await expect(copyDatabase(ctx, 'app-1', 'postgres://source.example/db', 'postgres://target.example/db'))
      .rejects.toThrow('Heroku PostgreSQL database must be source or target')
    expect((ctx.data as never as {transfer: {create: ReturnType<typeof vi.fn>}}).transfer.create).not.toHaveBeenCalled()
  })

  it('passes resolved endpoints to beforeCopy before transfer creation', async () => {
    const ctx = buildCtx()
    const beforeCopy = vi.fn()

    await copyDatabase(ctx, 'app-1', 'postgres://source.example/db', 'DATABASE_URL', {beforeCopy})

    expect(beforeCopy).toHaveBeenCalledWith({
      source: expect.objectContaining({name: 'database db on source.example:5432'}),
      target: expect.objectContaining({name: 'DATABASE'}),
    })
    const {transfer: {create}} = ctx.data as never as {transfer: {create: ReturnType<typeof vi.fn>}}
    expect(beforeCopy.mock.invocationCallOrder[0]).toBeLessThan(create.mock.invocationCallOrder[0])
  })

  it('projects attachment metadata from public callbacks while preserving transfer URLs', async () => {
    const sourceUrl = 'postgres://source-user:source-secret@source.example/db?sslmode=require'
    const targetUrl = 'postgres://target-user:target-secret@target.example/db?sslmode=require'
    const nestedUrl = 'https://metadata-user:metadata-secret@metadata.example/path?access_token=metadata-token'
    const attachment = {
      ...pgAttachment,
      privateMetadata: {connection: {url: nestedUrl}},
    }
    const transferCreate = vi.fn().mockResolvedValue({uuid: 'transfer-1'})
    const resolution = vi.fn().mockResolvedValue([attachment])
    const ctx = buildCtx({resolution, transferCreate})
    const {configVar} = ctx.platform as never as {configVar: {infoForApp: ReturnType<typeof vi.fn>}}
    configVar.infoForApp.mockResolvedValue({DATABASE_URL: sourceUrl})
    const beforeCopy = vi.fn()
    const copyPoller = {onStart: vi.fn(), onStop: vi.fn()}
    const waitPoller = {onStart: vi.fn(), onStop: vi.fn()}

    const result = await copyDatabase(ctx, 'app-1', 'DATABASE_URL', targetUrl, {
      beforeCopy,
      copyPoller,
      waitPoller,
    })

    expect(transferCreate).toHaveBeenCalledWith('addon-1', {
      from_name: 'DATABASE',
      from_url: sourceUrl,
      to_name: 'database db on target.example:5432',
      to_url: targetUrl,
    })
    for (const value of [
      beforeCopy.mock.calls[0],
      copyPoller.onStart.mock.calls[0],
      copyPoller.onStop.mock.calls[0],
      waitPoller.onStart.mock.calls[0],
      waitPoller.onStop.mock.calls[0],
      result,
    ]) {
      const serialized = JSON.stringify(value)
      expect(serialized).not.toContain(nestedUrl)
      expect(serialized).not.toMatch(/metadata-user|metadata-secret|metadata-token/)
      expect(serialized).not.toContain('privateMetadata')
    }
  })

  it('keeps credential URLs private while sending exact URLs to transfer creation', async () => {
    const sourceUrl = 'postgres://source-user:source-secret@source.example/db?sslmode=require'
    const targetUrl = 'postgres://target-user:target-secret@heroku.example/database?sslmode=require'
    const ctx = buildCtx({transferCreate: vi.fn().mockResolvedValue({from_url: sourceUrl, to_url: targetUrl, uuid: 'transfer-1'})})
    const {configVar} = ctx.platform as never as {configVar: {infoForApp: ReturnType<typeof vi.fn>}}
    configVar.infoForApp.mockResolvedValue({DATABASE_URL: targetUrl})
    const beforeCopy = vi.fn()
    const copyPoller = {onStart: vi.fn(), onStop: vi.fn()}
    const waitPoller = {onStart: vi.fn(), onStop: vi.fn()}
    const onPoll = vi.fn()
    const {transfer} = ctx.data as never as {transfer: {create: ReturnType<typeof vi.fn>; infoByApp: ReturnType<typeof vi.fn>}}
    const {create: transferCreate, infoByApp} = transfer
    infoByApp.mockResolvedValue({
      finished_at: 'now',
      from_url: sourceUrl,
      logs: [{message: `copying ${sourceUrl}`}],
      succeeded: true,
      to_url: targetUrl,
      uuid: 'transfer-1',
    })

    const result = await copyDatabase(ctx, 'app-1', sourceUrl, 'DATABASE_URL', {
      beforeCopy,
      copyPoller,
      onPoll,
      waitPoller,
    })

    expect(transferCreate).toHaveBeenCalledWith('addon-1', {
      from_name: 'database db on source.example:5432',
      from_url: sourceUrl,
      to_name: 'DATABASE',
      to_url: targetUrl,
    })
    for (const value of [
      beforeCopy.mock.calls[0],
      copyPoller.onStart.mock.calls[0],
      copyPoller.onStop.mock.calls[0],
      waitPoller.onStart.mock.calls[0],
      waitPoller.onStop.mock.calls[0],
      onPoll.mock.calls[0],
      result,
    ]) {
      const serialized = JSON.stringify(value)
      expect(serialized).not.toContain('source-secret')
      expect(serialized).not.toContain('target-secret')
    }

    expect(result.source).toEqual(expect.objectContaining({name: 'database db on source.example:5432'}))
    expect(result.target).toEqual(expect.objectContaining({name: 'DATABASE'}))
    expect(JSON.stringify(result.source)).not.toContain(sourceUrl)
    expect(JSON.stringify(result.source)).not.toContain('sslmode=require')
    expect(JSON.stringify(result.target)).not.toContain(targetUrl)

    expect(result.transfer.logs).toEqual([{message: 'copying postgres://[REDACTED]'}])
  })

  it('fully redacts credential-free source and target URLs from callbacks, results, and errors', async () => {
    const sourceUrl = 'postgres://source.example/private-source?sslmode=require'
    const targetUrl = 'postgres://heroku.example/private-target?sslmode=verify-full'
    const infoByApp = vi.fn().mockResolvedValue({
      finished_at: 'now',
      from_url: sourceUrl,
      logs: [{message: `copying ${sourceUrl} to ${targetUrl}`}],
      succeeded: true,
      to_url: targetUrl,
      uuid: 'transfer-1',
    })
    const transferCreate = vi.fn().mockResolvedValue({uuid: 'transfer-1'})
    const ctx = buildCtx({infoByApp, transferCreate})
    const {configVar} = ctx.platform as never as {configVar: {infoForApp: ReturnType<typeof vi.fn>}}
    configVar.infoForApp.mockResolvedValue({DATABASE_URL: targetUrl})
    const beforeCopy = vi.fn()
    const copyPoller = {onStart: vi.fn(), onStop: vi.fn()}
    const waitPoller = {onStart: vi.fn(), onStop: vi.fn()}
    const onPoll = vi.fn()

    const result = await copyDatabase(ctx, 'app-1', sourceUrl, 'DATABASE_URL', {
      beforeCopy,
      copyPoller,
      onPoll,
      waitPoller,
    })

    expect(transferCreate).toHaveBeenCalledWith('addon-1', {
      from_name: 'database private-source on source.example:5432',
      from_url: sourceUrl,
      to_name: 'DATABASE',
      to_url: targetUrl,
    })

    const successfulPublicValues = [
      beforeCopy.mock.calls,
      copyPoller.onStart.mock.calls,
      copyPoller.onStop.mock.calls,
      waitPoller.onStart.mock.calls,
      waitPoller.onStop.mock.calls,
      onPoll.mock.calls,
      result,
    ]
    for (const value of successfulPublicValues) {
      const serialized = JSON.stringify(value)
      expect(serialized).not.toContain(sourceUrl)
      expect(serialized).not.toContain(targetUrl)
      expect(serialized).not.toContain('sslmode')
    }

    expect(result.source.name).toBe('database private-source on source.example:5432')

    const failingOnPoll = vi.fn(() => {
      throw new Error(`could not display ${sourceUrl} -> ${targetUrl}`)
    })
    const error = await copyDatabase(ctx, 'app-1', sourceUrl, 'DATABASE_URL', {onPoll: failingOnPoll})
      .catch((error_: unknown) => error_)
    const failedPublicValues = JSON.stringify({callbacks: failingOnPoll.mock.calls, error, message: (error as Error).message})

    expect(error).toBeInstanceOf(DatabaseCopyTransferError)
    expect(failedPublicValues).not.toContain(sourceUrl)
    expect(failedPublicValues).not.toContain(targetUrl)
    expect(failedPublicValues).not.toMatch(/private-source|private-target|sslmode/)
    expect(failedPublicValues).toContain('postgres://[REDACTED]')
  })

  it('returns false warning fact when the source is external and does not list credentials', async () => {
    const credentials = vi.fn()
    const ctx = buildCtx({credentials})

    const result = await copyDatabase(ctx, 'app-1', 'postgres://source.example/db', 'DATABASE_URL')

    expect(credentials).not.toHaveBeenCalled()
    expect(result).toEqual(expect.objectContaining({credentialCount: undefined, hasAdditionalCredentials: false}))
  })

  it('retrieves classic source credential count before polling and exposes warning fact when count exceeds one', async () => {
    const order: string[] = []
    const credentials = vi.fn().mockResolvedValue([{user: 'default'}, {user: 'extra'}])
    credentials.mockImplementation(async () => {
      order.push('credentials')
      return [{user: 'default'}, {user: 'extra'}]
    })
    const transferCreate = vi.fn().mockImplementation(async () => {
      order.push('create')
      return {uuid: 'transfer-1'}
    })
    const infoByApp = vi.fn().mockImplementation(async () => {
      order.push('poll')
      return {finished_at: 'now', succeeded: true, uuid: 'transfer-1'}
    })
    const ctx = buildCtx({credentials, infoByApp, transferCreate})
    const onCredentialsChecked = vi.fn()

    const result = await copyDatabase(ctx, 'app-1', 'DATABASE_URL', 'postgres://target.example/db', {onCredentialsChecked})

    expect(credentials).toHaveBeenCalledWith('addon-1')
    expect(order).toEqual(['create', 'poll', 'credentials'])
    expect(onCredentialsChecked).toHaveBeenCalledWith({credentialCount: 2, hasAdditionalCredentials: true})
    expect(result.credentialCount).toBe(2)
    expect(result.hasAdditionalCredentials).toBe(true)
  })

  it('uses Basic auth only for the optional legacy credential lookup', async () => {
    const order: string[] = []
    const credentials = vi.fn().mockResolvedValue([{user: 'default'}])
    const transferCreate = vi.fn().mockImplementation(async () => {
      order.push('create')
      return {uuid: 'transfer-1'}
    })
    const infoByApp = vi.fn().mockImplementation(async () => {
      order.push('poll')
      return {finished_at: 'now', succeeded: true, uuid: 'transfer-1'}
    })
    const credentialGet = vi.fn().mockImplementation(async () => {
      order.push('credentials')
      return {json: async () => [{user: 'default'}, {user: 'extra'}]}
    })
    const makeClient = vi.fn().mockReturnValue({get: credentialGet})
    const ctx = buildCtx({
      credentials,
      infoByApp,
      makeClient,
      transferCreate,
    })
    const token = 'legacy-secret-token'

    const result = await copyDatabase(ctx, 'app-1', 'DATABASE_URL', 'postgres://target.example/db', {
      credentialToken: token,
    })

    expect(makeClient).toHaveBeenCalledOnce()
    expect(makeClient).toHaveBeenCalledWith('data', {
      headers: {Authorization: `Basic ${Buffer.from(`:${token}`).toString('base64')}`},
      token: expect.any(Function),
    })
    const clientOptions = makeClient.mock.calls[0][1] as {token: () => unknown}
    expect(clientOptions.token()).toBeUndefined()
    expect(credentialGet).toHaveBeenCalledOnce()
    expect(credentialGet).toHaveBeenCalledWith('/postgres/v0/databases/postgres-1/credentials', {signal: expect.any(AbortSignal)})
    expect(credentials).not.toHaveBeenCalled()
    expect(transferCreate).toHaveBeenCalledOnce()
    expect(infoByApp).toHaveBeenCalledOnce()
    expect(order).toEqual(['create', 'poll', 'credentials'])
    expect(result.credentialCount).toBe(2)
  })

  it('encodes add-on names in the optional credential lookup path', async () => {
    const attachment = {...pgAttachment, addon: {...pgAttachment.addon, name: 'postgres/name ?'}}
    const resolution = vi.fn().mockResolvedValue([attachment])
    const credentialGet = vi.fn().mockResolvedValue({json: async () => [{user: 'default'}]})
    const makeClient = vi.fn().mockReturnValue({get: credentialGet})
    const ctx = buildCtx({makeClient, resolution})

    await copyDatabase(ctx, 'app-1', 'DATABASE_URL', 'postgres://target.example/db', {credentialToken: 'token'})

    expect(credentialGet).toHaveBeenCalledWith('/postgres/v0/databases/postgres%2Fname%20%3F/credentials', {signal: expect.any(AbortSignal)})
  })

  it('does not recommend warning when source credential count is one', async () => {
    const credentials = vi.fn().mockResolvedValue([{user: 'default'}])
    const ctx = buildCtx({credentials})

    const result = await copyDatabase(ctx, 'app-1', 'DATABASE_URL', 'postgres://target.example/db')

    expect(result.credentialCount).toBe(1)
    expect(result.hasAdditionalCredentials).toBe(false)
  })

  it('retains the full verbose transfer record and logs on transfer failure', async () => {
    const verboseTransfer = {
      created_at: '2026-11-09 10:00:00 +0000',
      finished_at: '2026-11-09 10:01:00 +0000',
      from_name: 'source-db',
      from_type: 'pg_dump',
      from_url: 'postgres://source.example/db',
      logs: [
        {created_at: '2026-11-09 10:00:30 +0000', level: 'info', message: 'Starting copy'},
        {created_at: '2026-11-09 10:00:59 +0000', level: 'error', message: 'copy failed: permission denied'},
      ],
      num: 42,
      processed_bytes: 1024,
      succeeded: false,
      to_name: 'DATABASE',
      to_type: 'pg_restore',
      to_url: 'postgres://heroku/database',
      uuid: 'transfer-1',
      warnings: 0,
    }
    const infoByApp = vi.fn()
      .mockResolvedValueOnce({finished_at: 'now', succeeded: false, uuid: 'transfer-1'})
      .mockResolvedValueOnce(verboseTransfer)
    const waitPoller = {onStart: vi.fn(), onStop: vi.fn()}
    const ctx = buildCtx({infoByApp})

    const error = await copyDatabase(ctx, 'app-1', 'postgres://source.example/db', 'DATABASE_URL', {waitPoller})
      .catch((error_: unknown) => error_)

    expect(error).toBeInstanceOf(TransferFailedError)
    expect((error as TransferFailedError).name).toBe('TransferFailedError')
    expect((error as TransferFailedError).message).toBe('An error occurred and the transfer did not finish.')
    expect((error as TransferFailedError).body).toEqual({id: 'transfer_failed', message: 'An error occurred and the transfer did not finish.'})
    expect((error as TransferFailedError).transferId).toBe('transfer-1')
    expect((error as TransferFailedError).transfer).toHaveProperty('from_url', 'postgres://[REDACTED]')
    expect((error as TransferFailedError).transfer).toHaveProperty('to_url', 'postgres://[REDACTED]')
    expect((error as TransferFailedError).transfer).toMatchObject({
      finished_at: '2026-11-09 10:01:00 +0000',
      succeeded: false,
      uuid: 'transfer-1',
    })
    expect((error as TransferFailedError).transfer.logs).toEqual(verboseTransfer.logs)
    expect(infoByApp).toHaveBeenCalledTimes(2)
    expect(infoByApp).toHaveBeenNthCalledWith(1, 'app-1', 'transfer-1', {verbose: undefined})
    expect(infoByApp).toHaveBeenNthCalledWith(2, 'app-1', 'transfer-1', {verbose: true})
    expect(waitPoller.onStart).toHaveBeenCalledOnce()
    expect(waitPoller.onStop).not.toHaveBeenCalled()
  })

  it('redacts credentials from failed transfer records while retaining useful logs and status', async () => {
    const sourceUrl = 'postgres://source-user:source-secret@source.example/db?sslmode=require'
    const verboseTransfer = {
      finished_at: 'now',
      from_url: sourceUrl,
      logs: [{level: 'error', message: `copy failed at ${sourceUrl}: permission denied`}],
      succeeded: false,
      uuid: 'transfer-1',
    }
    const infoByApp = vi.fn()
      .mockResolvedValueOnce({finished_at: 'now', succeeded: false, uuid: 'transfer-1'})
      .mockResolvedValueOnce(verboseTransfer)
    const ctx = buildCtx({infoByApp})

    const error = await copyDatabase(ctx, 'app-1', sourceUrl, 'DATABASE_URL')
      .catch((error_: unknown) => error_)

    expect(error).toBeInstanceOf(TransferFailedError)
    expect(JSON.stringify((error as TransferFailedError).transfer)).not.toContain('source-secret')
    expect((error as TransferFailedError).transfer).toEqual({
      finished_at: verboseTransfer.finished_at,
      from_url: 'postgres://[REDACTED]',
      logs: [{level: 'error', message: 'copy failed at postgres://[REDACTED] permission denied'}],
      succeeded: false,
      uuid: 'transfer-1',
    })
  })

  it('continues observing a transfer when source credential lookup fails', async () => {
    const sourceUrl = 'postgres://source-user:source-secret@source.example/db'
    const infoByApp = vi.fn().mockResolvedValue({finished_at: 'now', succeeded: true, uuid: 'transfer-1'})
    const credentials = vi.fn().mockRejectedValue(new Error(`credential service unavailable for ${sourceUrl}`))
    const waitPoller = {onStart: vi.fn(), onStop: vi.fn()}
    const ctx = buildCtx({credentials, infoByApp})
    const {configVar} = ctx.platform as never as {configVar: {infoForApp: ReturnType<typeof vi.fn>}}
    configVar.infoForApp.mockResolvedValue({DATABASE_URL: sourceUrl})

    const error = await copyDatabase(ctx, 'app-1', 'DATABASE_URL', 'postgres://target.example/db', {waitPoller})
      .catch((error_: unknown) => error_)

    expect(error).toBeInstanceOf(DatabaseCopyTransferError)
    expect((error as DatabaseCopyTransferError).transferId).toBe('transfer-1')
    expect((error as DatabaseCopyTransferError).transfer).toEqual({finished_at: 'now', succeeded: true, uuid: 'transfer-1'})
    expect((error as Error).message).toContain('source credential lookup failed: credential service unavailable for postgres://[REDACTED]')
    expect((error as Error).message).not.toContain('source-secret')
    expect(infoByApp).toHaveBeenCalledOnce()
    expect(waitPoller.onStart).toHaveBeenCalledOnce()
    expect(waitPoller.onStop).toHaveBeenCalledOnce()
  })

  it('continues observing after wait-hook and poll-callback failures and cleans up the poller', async () => {
    const infoByApp = vi.fn()
      .mockResolvedValueOnce({finished_at: undefined, succeeded: false, uuid: 'transfer-1'})
      .mockResolvedValueOnce({finished_at: 'now', succeeded: true, uuid: 'transfer-1'})
    const waitPoller = {
      onStart: vi.fn(() => {
        throw new Error('wait hook failed')
      }),
      onStop: vi.fn(),
    }
    const onPoll = vi.fn(async () => {
      throw new Error('poll display failed')
    })
    const ctx = buildCtx({infoByApp})

    const error = await copyDatabase(ctx, 'app-1', 'postgres://source.example/db', 'DATABASE_URL', {
      intervalMs: 1,
      onPoll,
      waitPoller,
    }).catch((error_: unknown) => error_)

    expect(error).toBeInstanceOf(DatabaseCopyTransferError)
    expect((error as DatabaseCopyTransferError).transferId).toBe('transfer-1')
    expect((error as DatabaseCopyTransferError).transfer?.succeeded).toBe(true)
    expect((error as Error).message).toContain('wait progress callback failed: wait hook failed')
    expect((error as Error).message).toContain('transfer poll callback failed: poll display failed')
    expect(infoByApp).toHaveBeenCalledTimes(2)
    expect(onPoll).toHaveBeenCalledTimes(2)
    expect(waitPoller.onStop).toHaveBeenCalledOnce()
  })

  it('continues observing when the copy progress completion callback fails', async () => {
    const infoByApp = vi.fn().mockResolvedValue({finished_at: 'now', succeeded: true, uuid: 'transfer-1'})
    const copyPoller = {
      onStart: vi.fn(),
      onStop: vi.fn(() => {
        throw new Error('copy progress output failed')
      }),
    }
    const ctx = buildCtx({infoByApp})

    const error = await copyDatabase(ctx, 'app-1', 'postgres://source.example/db', 'DATABASE_URL', {copyPoller})
      .catch((error_: unknown) => error_)

    expect(error).toBeInstanceOf(DatabaseCopyTransferError)
    expect((error as DatabaseCopyTransferError).transferId).toBe('transfer-1')
    expect((error as DatabaseCopyTransferError).transfer?.succeeded).toBe(true)
    expect((error as Error).message).toContain('copy progress callback failed: copy progress output failed')
    expect(infoByApp).toHaveBeenCalledOnce()
  })

  it('continues observing after transfer creation callback setup error and preserves transfer metadata', async () => {
    const sourceUrl = 'postgres://source-user:source-secret@source.example/db'
    const createdTransfer = {from_url: sourceUrl, logs: ['created'], uuid: 'transfer-1'}
    const transferCreate = vi.fn().mockResolvedValue(createdTransfer)
    const infoByApp = vi.fn().mockResolvedValue({finished_at: 'now', succeeded: true, uuid: 'transfer-1'})
    const waitPoller = {
      onStart: vi.fn((transfer: {uuid: string}) => {
        expect(JSON.stringify(transfer)).not.toContain('source-secret')
        throw new Error(`could not display ${sourceUrl}`)
      }),
      onStop: vi.fn(),
    }
    const ctx = buildCtx({infoByApp, transferCreate})
    const {configVar} = ctx.platform as never as {configVar: {infoForApp: ReturnType<typeof vi.fn>}}
    configVar.infoForApp.mockResolvedValue({DATABASE_URL: sourceUrl})

    const error = await copyDatabase(ctx, 'app-1', 'DATABASE_URL', 'postgres://target.example/db', {waitPoller})
      .catch((error_: unknown) => error_)

    expect(error).toBeInstanceOf(DatabaseCopyTransferError)
    expect((error as DatabaseCopyTransferError).transferId).toBe('transfer-1')
    expect((error as DatabaseCopyTransferError).transfer).toMatchObject({uuid: 'transfer-1'})
    expect(JSON.stringify(error)).not.toContain('source-secret')
    expect((error as Error).message).toContain('wait progress callback failed: could not display postgres://[REDACTED]')
    expect(infoByApp).toHaveBeenCalledOnce()
    expect(waitPoller.onStop).toHaveBeenCalledOnce()
  })

  it('continues observing when the credential callback fails', async () => {
    const sourceUrl = 'postgres://source-user:source-secret@source.example/db'
    const infoByApp = vi.fn().mockResolvedValue({finished_at: 'now', succeeded: true, uuid: 'transfer-1'})
    const ctx = buildCtx({infoByApp})
    const {configVar} = ctx.platform as never as {configVar: {infoForApp: ReturnType<typeof vi.fn>}}
    configVar.infoForApp.mockResolvedValue({DATABASE_URL: sourceUrl})
    const onCredentialsChecked = vi.fn(() => {
      throw new Error(`warning output failed for ${sourceUrl}`)
    })

    const error = await copyDatabase(ctx, 'app-1', 'DATABASE_URL', 'postgres://target.example/db', {onCredentialsChecked})
      .catch((error_: unknown) => error_)

    expect(error).toBeInstanceOf(DatabaseCopyTransferError)
    expect((error as DatabaseCopyTransferError).transferId).toBe('transfer-1')
    expect((error as DatabaseCopyTransferError).transfer?.succeeded).toBe(true)
    expect((error as Error).message).toContain('credential callback failed: warning output failed for postgres://[REDACTED]')
    expect((error as Error).message).not.toContain('source-secret')
    expect(infoByApp).toHaveBeenCalledOnce()
  })

  it('surfaces the created transfer ID on post-create abort without running wait-poller stop', async () => {
    const controller = new AbortController()
    const sourceUrl = 'postgres://source-user:source-secret@source.example/db?token=source-token'
    const infoByApp = vi.fn().mockResolvedValue({finished_at: undefined, succeeded: false, uuid: 'transfer-1'})
    const credentials = vi.fn().mockImplementation(() => {
      controller.abort(new Error(`canceled ${sourceUrl}`))
      return Promise.reject(new Error('credential request canceled'))
    })
    const waitPoller = {onStart: vi.fn(), onStop: vi.fn()}
    const ctx = buildCtx({credentials, infoByApp})
    const {configVar} = ctx.platform as never as {configVar: {infoForApp: ReturnType<typeof vi.fn>}}
    configVar.infoForApp.mockResolvedValue({DATABASE_URL: sourceUrl})

    const error = await copyDatabase(ctx, 'app-1', 'DATABASE_URL', 'postgres://target.example/target', {
      signal: controller.signal,
      waitPoller,
    }).catch((error_: unknown) => error_)

    expect(error).toBeInstanceOf(DatabaseCopyTransferError)
    expect((error as DatabaseCopyTransferError).name).toBe('AbortError')
    expect((error as DatabaseCopyTransferError).transferId).toBe('transfer-1')
    expect(error).not.toHaveProperty('transfer')
    expect((error as Error & {cause?: Error}).cause?.message).toContain('postgres://[REDACTED]')
    expect((error as Error & {cause?: Error}).cause?.message).not.toMatch(/source-user|source-secret|source-token/)
    expect(JSON.stringify({cause: (error as Error & {cause?: Error}).cause, error})).not.toMatch(/source-user|source-secret|source-token|source\.example|private|target\.example/)
    expect(infoByApp).toHaveBeenCalledOnce()
    expect(waitPoller.onStart).toHaveBeenCalledOnce()
    expect(waitPoller.onStop).not.toHaveBeenCalled()
  })

  it('omits the created transfer payload when transfer observation rejects with AbortError', async () => {
    const abortError = Object.assign(new Error('poll aborted'), {name: 'AbortError'})
    const infoByApp = vi.fn().mockRejectedValue(abortError)
    const ctx = buildCtx({infoByApp})

    const error = await copyDatabase(ctx, 'app-1', 'DATABASE_URL', 'postgres://target.example/target')
      .catch((error_: unknown) => error_)

    expect(error).toBeInstanceOf(DatabaseCopyTransferError)
    expect(error).toMatchObject({name: 'AbortError', transferId: 'transfer-1'})
    expect(error).not.toHaveProperty('transfer')
    expect((error as Error & {cause?: Error}).cause?.message).toBe('poll aborted')
    expect(infoByApp).toHaveBeenCalledOnce()
  })

  it('sanitizes nested URLs from post-create abort reasons without canceling the remote transfer', async () => {
    const controller = new AbortController()
    const abortUrl = 'postgres://user:secret@host/db?sslmode=require'
    const abortReason = {details: {endpoint: abortUrl}}
    const infoByApp = vi.fn(() => new Promise<never>(() => {}))
    const transferCancel = vi.fn()
    const credentials = vi.fn().mockImplementation(() => {
      controller.abort(abortReason)
      return Promise.reject(new Error('credential request canceled'))
    })
    const ctx = buildCtx({credentials, infoByApp})
    const {transfer: transferApi} = ctx.data as never as {transfer: Record<string, unknown>}
    transferApi.cancel = transferCancel

    const error = await copyDatabase(ctx, 'app-1', 'DATABASE_URL', 'postgres://target.example/target', {
      signal: controller.signal,
    }).catch((error_: unknown) => error_)
    const {cause} = error as Error & {cause?: Error & {cause?: unknown}}
    const serialized = JSON.stringify({cause, error, reason: cause?.cause})

    expect(error).toBeInstanceOf(DatabaseCopyTransferError)
    expect(error).toMatchObject({name: 'AbortError', transferId: 'transfer-1'})
    expect(error).not.toHaveProperty('transfer')
    expect((cause?.cause as undefined | {details?: {endpoint?: string}})?.details?.endpoint).toBe('postgres://[REDACTED]')
    expect(serialized).not.toContain(abortUrl)
    expect(serialized).not.toMatch(/user|secret|host|\/db|sslmode=require/)
    expect(serialized).toContain('postgres://[REDACTED]')
    expect(infoByApp).toHaveBeenCalledOnce()
    expect(transferCancel).not.toHaveBeenCalled()
  })

  it('does not await a never-settling async onPoll and preserves timeout identity without transfer payload', async () => {
    const infoByApp = vi.fn().mockResolvedValue({finished_at: undefined, succeeded: false, uuid: 'transfer-1'})
    const ctx = buildCtx({infoByApp})
    const onPoll = vi.fn(() => new Promise<void>(() => {}))
    const waitPoller = {onStart: vi.fn(neverSettles), onStop: vi.fn(neverSettles)}

    const error = await copyDatabase(ctx, 'app-1', 'DATABASE_URL', 'postgres://target.example/db', {
      intervalMs: 1,
      onPoll,
      timeoutMs: 10,
      waitPoller,
    }).catch((error_: unknown) => error_)

    expect(error).toBeInstanceOf(TransferTimeoutError)
    expect(error).not.toBeInstanceOf(DatabaseCopyTransferError)
    expect((error as TransferTimeoutError).transferId).toBe('transfer-1')
    expect(error).not.toHaveProperty('transfer')
    expect(infoByApp).toHaveBeenCalled()
    expect(onPoll).toHaveBeenCalled()
    expect(waitPoller.onStart).toHaveBeenCalledOnce()
    expect(waitPoller.onStop).not.toHaveBeenCalled()
  })

  it('aborts a timed transfer-copy poll when its SDK-scoped signal aborts', async () => {
    const controller = new AbortController()
    let pollSignal: AbortSignal | undefined
    const infoByApp = vi.fn()
      .mockResolvedValueOnce({finished_at: undefined, succeeded: false, uuid: 'transfer-1'})
      .mockResolvedValueOnce({finished_at: undefined, succeeded: false, uuid: 'transfer-1'})
      .mockImplementation(() => new Promise((_, reject) => {
        pollSignal?.addEventListener('abort', () => reject(pollSignal?.reason), {once: true})
      }))
    const ctx = buildCtx({
      infoByApp,
      onSignal(signal) {
        pollSignal = signal
      },
    })
    const pending = buildSdkDataClient(ctx).withOptions({signal: controller.signal})
      .database.copy('app-1', 'postgres://source.example/db', 'DATABASE_URL', {timeoutMs: 1000})
      .then(value => ({value}), error_ => ({error_}))

    await vi.waitFor(() => expect(infoByApp).toHaveBeenCalledOnce())
    const effectiveSignal = pollSignal
    expect(effectiveSignal).toBeInstanceOf(AbortSignal)
    expect(effectiveSignal).not.toBe(controller.signal)

    controller.abort(new Error('SDK-scoped cancellation'))

    const {error_} = await pending
    expect(error_).toBeInstanceOf(DatabaseCopyTransferError)
    expect(error_).toMatchObject({name: 'AbortError', transferId: 'transfer-1'})
    expect(error_).not.toHaveProperty('transfer')
    expect(effectiveSignal?.aborted).toBe(true)
    expect(controller.signal.aborted).toBe(true)
  })

  it('omits transfer payload when caller aborts after successful transfer polling', async () => {
    const controller = new AbortController()
    const sourceUrl = 'postgres://source-user:source-secret@source.example/db?token=source-token'
    const targetUrl = 'postgres://target-user:target-secret@target.example/db?password=target-token'
    const infoByApp = vi.fn().mockResolvedValue({finished_at: 'now', succeeded: true, uuid: 'transfer-1'})
    const waitPoller = {
      onStart: vi.fn(),
      onStop: vi.fn(() => controller.abort(new Error(`canceled ${sourceUrl} -> ${targetUrl}`))),
    }
    const ctx = buildCtx({infoByApp})
    const {configVar} = ctx.platform as never as {configVar: {infoForApp: ReturnType<typeof vi.fn>}}
    configVar.infoForApp.mockResolvedValue({DATABASE_URL: sourceUrl})

    const error = await copyDatabase(ctx, 'app-1', 'DATABASE_URL', targetUrl, {
      signal: controller.signal,
      waitPoller,
    }).catch((error_: unknown) => error_)
    const serialized = JSON.stringify({cause: (error as Error & {cause?: Error}).cause, error, message: (error as Error).message})

    expect(error).toBeInstanceOf(DatabaseCopyTransferError)
    expect(error).toMatchObject({name: 'AbortError', transferId: 'transfer-1'})
    expect(error).not.toHaveProperty('transfer')
    expect(serialized).not.toMatch(/source-user|source-secret|source-token|source\.example|target-user|target-secret|target-token|target\.example/)
    expect(waitPoller.onStop).toHaveBeenCalledOnce()
  })

  it('sanitizes timeout errors and preserves the created transfer ID when a copy poll expires', async () => {
    const controller = new AbortController()
    const sourceUrl = 'postgres://source-user:source-secret@source.example/private-source?token=source-token'
    const targetUrl = 'postgres://target-user:target-secret@heroku.example/private-target?password=target-token'
    let pollSignal: AbortSignal | undefined
    let startSecondPoll!: () => void
    const secondPollStarted = new Promise<void>(resolve => {
      startSecondPoll = resolve
    })
    let pollCount = 0
    const infoByApp = vi.fn()
      .mockImplementation(() => {
        pollCount++
        if (pollCount === 1) return Promise.resolve({finished_at: undefined, succeeded: false, uuid: 'transfer-1'})
        startSecondPoll()
        return new Promise((_, reject) => {
          pollSignal?.addEventListener('abort', () => reject(pollSignal?.reason), {once: true})
        })
      })
    const ctx = buildCtx({
      infoByApp,
      onSignal(signal) {
        pollSignal = signal
      },
    })
    const {configVar} = ctx.platform as never as {configVar: {infoForApp: ReturnType<typeof vi.fn>}}
    configVar.infoForApp.mockResolvedValue({DATABASE_URL: targetUrl})
    const onPoll = vi.fn(() => {
      throw new Error(`could not display ${sourceUrl} -> ${targetUrl}`)
    })
    const pending = buildSdkDataClient(ctx).withOptions({signal: controller.signal})
      .database.copy('app-1', sourceUrl, 'DATABASE_URL', {
        intervalMs: 3,
        onPoll,
        timeoutMs: 50,
      }).then(value => ({value}), error_ => ({error_}))

    await secondPollStarted
    const {error_} = await pending

    expect(error_).toBeInstanceOf(TransferTimeoutError)
    expect(error_).toMatchObject({timeoutMs: 50, transferId: 'transfer-1'})
    expect(error_).not.toHaveProperty('transfer')
    const serializedError = JSON.stringify({error: error_, message: (error_ as Error).message})
    expect(serializedError).not.toContain(sourceUrl)
    expect(serializedError).not.toContain(targetUrl)
    expect(serializedError).not.toMatch(/source-user|source-secret|source-token|source\.example|private-source|target-user|target-secret|target-token|heroku\.example|private-target/)
    expect((error_ as Error).message).toContain('postgres://[REDACTED]')
    expect(onPoll).toHaveBeenCalledOnce()
    expect(pollSignal?.aborted).toBe(true)
    expect(controller.signal.aborted).toBe(false)
  })

  it('returns a completed transfer without waiting for never-settling credential lookup', async () => {
    const credentials = vi.fn(() => new Promise<never>(() => {}))
    const infoByApp = vi.fn().mockResolvedValue({finished_at: 'now', succeeded: true, uuid: 'transfer-1'})
    const ctx = buildCtx({credentials, infoByApp})

    const result = await copyDatabase(ctx, 'app-1', 'DATABASE_URL', 'postgres://target.example/db', {timeoutMs: 100})

    expect(result.transfer).toMatchObject({succeeded: true})
    expect(result.credentialCount).toBeUndefined()
    expect(infoByApp).toHaveBeenCalledOnce()
    const {withOptions} = ctx.data as never as {withOptions: ReturnType<typeof vi.fn>}
    const requestSignals = (withOptions.mock.calls as [{signal: AbortSignal}][])
      .map(([options]) => options.signal)
    expect(requestSignals).toHaveLength(2)
    expect(requestSignals[0].aborted).toBe(false)
    expect(requestSignals[1].aborted).toBe(true)
  })

  it('collects async wait-start and poll callback failures settled with the transfer outcome', async () => {
    const infoByApp = vi.fn().mockResolvedValue({finished_at: 'now', succeeded: true, uuid: 'transfer-1'})
    const ctx = buildCtx({infoByApp})
    const onPoll = vi.fn(async () => {
      throw new Error('async poll display failed')
    })
    const waitPoller = {
      onStart: vi.fn(async () => {
        throw new Error('async wait start failed')
      }),
      onStop: vi.fn(),
    }

    const error = await copyDatabase(ctx, 'app-1', 'postgres://source.example/db', 'DATABASE_URL', {onPoll, waitPoller})
      .catch((error_: unknown) => error_)

    expect(error).toBeInstanceOf(DatabaseCopyTransferError)
    expect((error as DatabaseCopyTransferError).transferId).toBe('transfer-1')
    expect((error as DatabaseCopyTransferError).transfer).toMatchObject({succeeded: true})
    expect((error as Error).message).toContain('async wait start failed')
    expect((error as Error).message).toContain('async poll display failed')
    expect((error as Error).message).not.toContain('async wait stop failed')
    expect(waitPoller.onStop).toHaveBeenCalledOnce()
  })

  it('does not let a failing wait-poller stop hook mask successful transfer completion', async () => {
    const infoByApp = vi.fn().mockResolvedValue({finished_at: 'now', succeeded: true, uuid: 'transfer-1'})
    const waitPoller = {
      onStart: vi.fn(),
      onStop: vi.fn(async () => {
        throw new Error('async wait stop failed')
      }),
    }
    const ctx = buildCtx({infoByApp})

    const result = await copyDatabase(ctx, 'app-1', 'postgres://source.example/db', 'DATABASE_URL', {waitPoller})

    expect(result.transfer).toMatchObject({finished_at: 'now', succeeded: true, uuid: 'transfer-1'})
    expect(infoByApp).toHaveBeenCalledOnce()
    expect(waitPoller.onStop).toHaveBeenCalledOnce()
  })

  it('exports the database copy transfer error from the public data barrel', () => {
    expect(PublicDatabaseCopyTransferError).toBe(DatabaseCopyTransferError)
  })

  it('declares the data.database copy extension', () => {
    expect(databaseCopyExtensions.service).toBe('data')
    expect(databaseCopyExtensions.resource).toBe('database')
    expect(Object.keys(databaseCopyExtensions.factory({} as ResourceCtx))).toEqual(['copy'])
  })
})
