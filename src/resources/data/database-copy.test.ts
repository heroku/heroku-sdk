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
  onRequest?: (request: 'credentials' | 'transfer-poll', signal?: AbortSignal) => void
  onSignal?: (signal?: AbortSignal) => void
  operationSignal?: AbortSignal
  resolution?: ReturnType<typeof vi.fn>
  transferCreate?: ReturnType<typeof vi.fn>
} = {}): ResourceCtx {
  let requestSignal = opts.operationSignal
  const credentials = opts.credentials ?? vi.fn().mockResolvedValue([{user: 'default'}, {user: 'extra'}])
  const postgresDatabase = {
    get listCredentials() {
      opts.onRequest?.('credentials', requestSignal)
      return credentials
    },
  }
  const infoByApp = opts.infoByApp ?? vi.fn().mockResolvedValue({finished_at: 'now', succeeded: true, uuid: 'transfer-1'})
  const transfer = {
    create: opts.transferCreate ?? vi.fn().mockResolvedValue({uuid: 'transfer-1'}),
    infoByApp: opts.onSignal || opts.onRequest
      ? new Proxy(infoByApp, {
        apply(target, thisArg, args: unknown[]) {
          opts.onRequest?.('transfer-poll', requestSignal)
          return Reflect.apply(target, thisArg, [...args, ...(requestSignal ? [requestSignal] : [])])
        },
      })
      : infoByApp,
  }
  const data: Record<string, unknown> = {
    postgresDatabase,
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
    database: {copyForApp: typeof copyDatabase}
    withOptions: (options: {signal?: AbortSignal}) => ReturnType<typeof buildSdkDataClient>
  }
}

describe('database copy resource', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  it('redacts known endpoint URLs from abort reasons after beforeCopy without creating a transfer', async () => {
    class CopyAbortReason extends Error {
      public readonly metadata = {
        url: 'postgres://user%40name:p%40ss%2Fword@other.example/db?token=tok%2Ben',
      }
    }

    const controller = new AbortController()
    const sourceUrl = 'postgres://source-user:source-secret@source.example/db?token=source-token'
    const targetUrl = 'postgres://target-user:target-secret@target.example/db?password=target%2Btoken'
    const unrelatedUrl = 'https://metadata-user:metadata-secret@metadata.example/path?token=metadata-token'
    const reason = new CopyAbortReason(`stop ${sourceUrl} and ${targetUrl}; unrelated ${unrelatedUrl}`)
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
    expect(JSON.stringify(error)).toContain('postgres://user%40name:p%40ss%2Fword@other.example/db?token=tok%2Ben')
    expect(beforeCopy).toHaveBeenCalledOnce()
    expect((ctx.data as never as {postgresDatabase: {listCredentials: ReturnType<typeof vi.fn>}}).postgresDatabase.listCredentials).not.toHaveBeenCalled()
    expect((ctx.data as never as {transfer: {create: ReturnType<typeof vi.fn>}}).transfer.create).not.toHaveBeenCalled()
  })

  it('preserves unrelated resolver URLs and fields while redacting known endpoint URLs', async () => {
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
    expect((error as Error).name).toContain('https://resolver-user:resolver-pass@resolver.example/path?access_token=resolver-token')
    expect((error as ResolverError).details.request).toBe('https://resolver-user:resolver-pass@resolver.example/path?access_token=resolver-token')
    expect((error as ResolverError).details.password).toBe('resolver-pass')
    expect((error as ResolverError).details.token).toBe('resolver-token')
    expect((error as ResolverError).details.username).toBe('resolver-user')
    expect((error as Error).message).toContain('https://resolver-user:resolver-pass@resolver.example/path?access_token=resolver-token')
  })

  it('redacts only known database URLs and the legacy credential token in lookup errors', async () => {
    const sourceUrl = 'postgres://source.example/db?user=alice&password=source-secret'
    const token = 'prefix://legacy-secret-token'
    const encodedToken = encodeURIComponent(token)
    const basicAuthorization = `Basic ${Buffer.from(`:${token}`).toString('base64')}`
    const unrelatedUrl = 'https://metadata-user:metadata-secret@metadata.example/path?token=metadata-token'
    const lookupError = Object.assign(
      new Error(`lookup failed for ${sourceUrl}; token=${token}; encoded=${encodedToken}; ${basicAuthorization}; ${unrelatedUrl}`),
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
    const onCredentialsChecked = vi.fn()

    const pendingCopy = copyDatabase(ctx, 'app-1', 'DATABASE_URL', 'postgres://target.example/db', {
      credentialToken: token,
      onCredentialsChecked,
    })
    await vi.waitFor(() => expect(credentialGet).toHaveBeenCalledOnce())
    finishTransfer({finished_at: 'now', succeeded: true, uuid: 'transfer-1'})
    const result = await pendingCopy
    const warning = result.warnings.join('; ')

    expect(result.transfer.succeeded).toBe(true)
    expect(warning).toContain('source credential lookup failed: lookup failed for postgres://[REDACTED]')
    expect(warning).not.toContain(token)
    expect(warning).not.toContain('prefix')
    expect(warning).not.toContain('legacy-secret-token')
    expect(warning).not.toContain(encodedToken)
    expect(warning).not.toContain(basicAuthorization)
    expect(warning).not.toContain(Buffer.from(`:${token}`).toString('base64'))
    expect(warning).toContain(unrelatedUrl)
    expect(onCredentialsChecked).toHaveBeenCalledWith(expect.objectContaining({
      credentialCount: undefined,
      hasAdditionalCredentials: false,
      warning: expect.stringContaining('lookup failed for postgres://[REDACTED]'),
    }))
    expect(JSON.stringify(onCredentialsChecked.mock.calls)).not.toContain(token)
    expect(onCredentialsChecked.mock.invocationCallOrder[0]).toBeLessThan((ctx.data as never as {transfer: {create: ReturnType<typeof vi.fn>}}).transfer.create.mock.invocationCallOrder[0])
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

  it('preserves host and database name for a credential-free external target', async () => {
    const targetUrl = 'postgres://db.example.com:5432/mydb'
    const failedTransfer = {
      finished_at: 'now',
      from_name: 'DATABASE',
      succeeded: false,
      to_name: 'database mydb on db.example.com:5432',
      to_url: targetUrl,
      uuid: 'transfer-1',
    }
    const infoByApp = vi.fn()
      .mockResolvedValueOnce({finished_at: 'now', succeeded: false, uuid: 'transfer-1'})
      .mockResolvedValueOnce(failedTransfer)
    const ctx = buildCtx({infoByApp})
    const beforeCopy = vi.fn()

    const error = await copyDatabase(ctx, 'app-1', 'DATABASE_URL', targetUrl, {beforeCopy})
      .catch((error_: unknown) => error_)

    expect(beforeCopy).toHaveBeenCalledWith(expect.objectContaining({
      target: expect.objectContaining({confirm: 'mydb', name: 'database mydb on db.example.com:5432'}),
    }))
    expect(error).toBeInstanceOf(TransferFailedError)
    expect((error as TransferFailedError).transfer).toMatchObject({
      to_name: 'database mydb on db.example.com:5432',
      to_url: 'postgres://[REDACTED]',
    })
    expect((error as Error).message).not.toContain('postgres://db.example.com:5432')
    expect(JSON.stringify(error)).not.toMatch(/undefined:5432|db\.example\.com\/5432|@db\.example\.com/)
    expect(JSON.stringify(error)).toContain('database mydb on db.example.com:5432')
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

  it('redacts source and target URLs without credentials while preserving unrelated URLs and fields', async () => {
    const sourceUrl = 'postgres://source.example/private-source?sslmode=require'
    const targetUrl = 'postgres://heroku.example/private-target?sslmode=verify-full'
    const infoByApp = vi.fn().mockResolvedValue({
      finished_at: 'now',
      from_url: sourceUrl,
      logs: [{message: `copying ${sourceUrl} to ${targetUrl}`}],
      other_url: 'https://metadata.example/path?token=keep-this',
      other_username: 'source.exampl',
      succeeded: true,
      to_url: targetUrl,
      username: 'keep-this-user',
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
    expect(result.transfer).toMatchObject({
      from_url: 'postgres://[REDACTED]',
      other_url: 'https://metadata.example/path?token=keep-this',
      other_username: 'source.exampl',
      to_url: 'postgres://[REDACTED]',
      username: 'keep-this-user',
    })

    const failingOnPoll = vi.fn(() => {
      throw new Error(`could not display ${sourceUrl} -> ${targetUrl}`)
    })
    const failedResult = await copyDatabase(ctx, 'app-1', sourceUrl, 'DATABASE_URL', {onPoll: failingOnPoll})
    const failedPublicValues = JSON.stringify({callbacks: failingOnPoll.mock.calls, result: failedResult})

    expect(failedResult.transfer.succeeded).toBe(true)
    expect(failedResult.warnings.join('; ')).toContain('transfer poll callback failed: could not display postgres://[REDACTED] -> postgres://[REDACTED]')
    expect(failedPublicValues).not.toContain(sourceUrl)
    expect(failedPublicValues).not.toContain(targetUrl)
    expect(failedPublicValues).not.toContain('sslmode')
  })

  it('returns false warning fact when the source is external and does not list credentials', async () => {
    const credentials = vi.fn()
    const ctx = buildCtx({credentials})

    const result = await copyDatabase(ctx, 'app-1', 'postgres://source.example/db', 'DATABASE_URL')

    expect(credentials).not.toHaveBeenCalled()
    expect(result).toEqual(expect.objectContaining({credentialCount: undefined, hasAdditionalCredentials: false}))
  })

  it('does not emit a credential callback or lookup when beforeCopy rejects', async () => {
    const credentials = vi.fn()
    const onCredentialsChecked = vi.fn()
    const beforeCopy = vi.fn(() => {
      throw new Error('confirmation declined')
    })
    const ctx = buildCtx({credentials})

    await expect(copyDatabase(ctx, 'app-1', 'DATABASE_URL', 'postgres://target.example/db', {
      beforeCopy,
      onCredentialsChecked,
    })).rejects.toThrow('confirmation declined')

    expect(credentials).not.toHaveBeenCalled()
    expect(onCredentialsChecked).not.toHaveBeenCalled()
    expect((ctx.data as never as {transfer: {create: ReturnType<typeof vi.fn>}}).transfer.create).not.toHaveBeenCalled()
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
    const beforeCopy = vi.fn(() => {
      order.push('beforeCopy')
    })

    const result = await copyDatabase(ctx, 'app-1', 'DATABASE_URL', 'postgres://target.example/db', {beforeCopy, onCredentialsChecked})

    expect(credentials).toHaveBeenCalledWith('addon-1')
    expect(credentials).toHaveBeenCalledOnce()
    expect(order).toEqual(['beforeCopy', 'credentials', 'create', 'poll'])
    expect(onCredentialsChecked.mock.invocationCallOrder[0]).toBeLessThan(transferCreate.mock.invocationCallOrder[0])
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
    expect(order).toEqual(['credentials', 'create', 'poll'])
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
    expect((error as TransferFailedError).transfer.logs).toEqual([
      {created_at: '2026-11-09 10:00:30 +0000', level: 'info', message: 'Starting copy'},
      {created_at: '2026-11-09 10:00:59 +0000', level: 'error', message: 'copy failed: permission denied'},
    ])
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
      logs: [{level: 'error', message: 'copy failed at postgres://[REDACTED]: permission denied'}],
      succeeded: false,
      uuid: 'transfer-1',
    })
  })

  it('returns source credential lookup failures as warnings after successful transfer', async () => {
    const sourceUrl = 'postgres://source-user:source-secret@source.example/db'
    const infoByApp = vi.fn().mockResolvedValue({finished_at: 'now', succeeded: true, uuid: 'transfer-1'})
    const credentials = vi.fn().mockRejectedValue(new Error(`credential service unavailable for ${sourceUrl}`))
    const waitPoller = {onStart: vi.fn(), onStop: vi.fn()}
    const order: string[] = []
    credentials.mockImplementation(async () => {
      order.push('credentials')
      throw new Error(`credential service unavailable for ${sourceUrl}`)
    })
    const transferCreate = vi.fn().mockImplementation(async () => {
      order.push('create')
      return {uuid: 'transfer-1'}
    })
    const ctx = buildCtx({credentials, infoByApp, transferCreate})
    const {configVar} = ctx.platform as never as {configVar: {infoForApp: ReturnType<typeof vi.fn>}}
    configVar.infoForApp.mockResolvedValue({DATABASE_URL: sourceUrl})
    const onCredentialsChecked = vi.fn()

    const result = await copyDatabase(ctx, 'app-1', 'DATABASE_URL', 'postgres://target.example/db', {onCredentialsChecked, waitPoller})

    expect(result.transfer).toEqual({finished_at: 'now', succeeded: true, uuid: 'transfer-1'})
    expect(result.warnings).toContain('source credential lookup failed: credential service unavailable for postgres://[REDACTED]')
    expect(result.warnings.join('; ')).not.toContain('source-secret')
    expect(onCredentialsChecked).toHaveBeenCalledWith({
      credentialCount: undefined,
      hasAdditionalCredentials: false,
      warning: 'source credential lookup failed: credential service unavailable for postgres://[REDACTED]',
    })
    expect(order).toEqual(['credentials', 'create'])
    expect(infoByApp).toHaveBeenCalledOnce()
    expect(waitPoller.onStart).toHaveBeenCalledOnce()
    expect(waitPoller.onStop).toHaveBeenCalledOnce()
  })

  it('times out a slow credential lookup before transfer creation and ignores its late result', async () => {
    let settleCredentials!: (credentials: Array<{user: string}>) => void
    const credentials = vi.fn(() => new Promise<Array<{user: string}>>(resolve => {
      settleCredentials = resolve
    }))
    const transferCreate = vi.fn().mockResolvedValue({uuid: 'transfer-1'})
    const ctx = buildCtx({credentials, transferCreate})
    const onCredentialsChecked = vi.fn()

    const result = await copyDatabase(ctx, 'app-1', 'DATABASE_URL', 'postgres://target.example/db', {
      credentialLookupTimeoutMs: 5,
      onCredentialsChecked,
    })
    const warningSnapshot = [...result.warnings]

    expect(credentials).toHaveBeenCalledOnce()
    expect(onCredentialsChecked).toHaveBeenCalledWith({
      credentialCount: undefined,
      hasAdditionalCredentials: false,
      warning: 'source credential lookup failed: credential lookup timed out after 5ms',
    })
    expect(onCredentialsChecked.mock.invocationCallOrder[0]).toBeLessThan(transferCreate.mock.invocationCallOrder[0])
    expect(result.warnings).toContain('source credential lookup failed: credential lookup timed out after 5ms')
    expect(result.hasAdditionalCredentials).toBe(false)
    expect(transferCreate).toHaveBeenCalledOnce()
    expect(credentials.mock.invocationCallOrder[0]).toBeLessThan(transferCreate.mock.invocationCallOrder[0])

    settleCredentials([{user: 'default'}, {user: 'secret-late-credential'}])
    await new Promise<void>(resolve => {
      setTimeout(() => resolve(), 0)
    })

    expect(result.warnings).toEqual(warningSnapshot)
    expect(result.warnings.join('; ')).not.toContain('secret-late-credential')
  })

  it('awaits the pre-transfer credential callback within its timeout', async () => {
    const transferCreate = vi.fn().mockResolvedValue({uuid: 'transfer-1'})
    const ctx = buildCtx({credentials: vi.fn().mockResolvedValue([{user: 'default'}]), transferCreate})
    const onCredentialsChecked = vi.fn(() => new Promise<void>(() => {}))
    const result = await copyDatabase(ctx, 'app-1', 'DATABASE_URL', 'postgres://target.example/db', {
      credentialLookupTimeoutMs: 5,
      onCredentialsChecked,
    })

    expect(onCredentialsChecked).toHaveBeenCalledOnce()
    expect(onCredentialsChecked.mock.invocationCallOrder[0]).toBeLessThan(transferCreate.mock.invocationCallOrder[0])
    expect(result.warnings).toContain('credential callback failed: credential callback timed out after 5ms')
    expect(transferCreate).toHaveBeenCalledOnce()
  })

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])('rejects invalid credential lookup timeout %s', async credentialLookupTimeoutMs => {
    const ctx = buildCtx()

    await expect(copyDatabase(ctx, 'app-1', 'DATABASE_URL', 'postgres://target.example/db', {
      credentialLookupTimeoutMs,
    })).rejects.toBeInstanceOf(RangeError)
    expect((ctx.data as never as {transfer: {create: ReturnType<typeof vi.fn>}}).transfer.create).not.toHaveBeenCalled()
  })

  it('returns wait-hook and poll-callback failures as warnings after successful transfer', async () => {
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

    const result = await copyDatabase(ctx, 'app-1', 'postgres://source.example/db', 'DATABASE_URL', {
      intervalMs: 1,
      onPoll,
      waitPoller,
    })

    expect(result.transfer.succeeded).toBe(true)
    expect(result.warnings).toContain('wait progress callback failed: wait hook failed')
    expect(result.warnings).toContain('transfer poll callback failed: poll display failed')
    expect(infoByApp).toHaveBeenCalledTimes(2)
    expect(onPoll).toHaveBeenCalledTimes(2)
    expect(waitPoller.onStop).toHaveBeenCalledOnce()
  })

  it('returns copy progress completion callback failures as warnings', async () => {
    const infoByApp = vi.fn().mockResolvedValue({finished_at: 'now', succeeded: true, uuid: 'transfer-1'})
    const copyPoller = {
      onStart: vi.fn(),
      onStop: vi.fn(() => {
        throw new Error('copy progress output failed')
      }),
    }
    const ctx = buildCtx({infoByApp})

    const result = await copyDatabase(ctx, 'app-1', 'postgres://source.example/db', 'DATABASE_URL', {copyPoller})

    expect(result.transfer.succeeded).toBe(true)
    expect(result.warnings).toContain('copy progress callback failed: copy progress output failed')
    expect(infoByApp).toHaveBeenCalledOnce()
  })

  it('reports wait-start callback failure as warning while preserving transfer metadata', async () => {
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

    const result = await copyDatabase(ctx, 'app-1', 'DATABASE_URL', 'postgres://target.example/db', {waitPoller})

    expect(result.transfer).toMatchObject({uuid: 'transfer-1'})
    expect(JSON.stringify(result)).not.toContain('source-secret')
    expect(result.warnings.join('; ')).toContain('wait progress callback failed: could not display postgres://[REDACTED]')
    expect(infoByApp).toHaveBeenCalledOnce()
    expect(waitPoller.onStop).toHaveBeenCalledOnce()
  })

  it('returns credential callback failures as warnings after successful transfer', async () => {
    const sourceUrl = 'postgres://source-user:source-secret@source.example/db'
    const infoByApp = vi.fn().mockResolvedValue({finished_at: 'now', succeeded: true, uuid: 'transfer-1'})
    const ctx = buildCtx({infoByApp})
    const {configVar} = ctx.platform as never as {configVar: {infoForApp: ReturnType<typeof vi.fn>}}
    configVar.infoForApp.mockResolvedValue({DATABASE_URL: sourceUrl})
    const onCredentialsChecked = vi.fn(() => {
      throw new Error(`warning output failed for ${sourceUrl}`)
    })

    const result = await copyDatabase(ctx, 'app-1', 'DATABASE_URL', 'postgres://target.example/db', {onCredentialsChecked})

    expect(result.transfer.succeeded).toBe(true)
    expect(result.warnings.join('; ')).toContain('credential callback failed: warning output failed for postgres://[REDACTED]')
    expect(result.warnings.join('; ')).not.toContain('source-secret')
    expect(infoByApp).toHaveBeenCalledOnce()
  })

  it('surfaces the created transfer ID on post-create abort without running wait-poller stop', async () => {
    const controller = new AbortController()
    const sourceUrl = 'postgres://source-user:source-secret@source.example/db?token=source-token'
    const infoByApp = vi.fn(() => {
      queueMicrotask(() => controller.abort(new Error(`canceled ${sourceUrl}`)))
      return new Promise(() => {})
    })
    const credentials = vi.fn().mockResolvedValue([{user: 'default'}])
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

  it('preserves unrelated nested URLs in post-create abort reasons without canceling the remote transfer', async () => {
    const controller = new AbortController()
    const abortUrl = 'postgres://user:secret@host/db?sslmode=require'
    const abortReason = {details: {endpoint: abortUrl}}
    const infoByApp = vi.fn(() => {
      queueMicrotask(() => controller.abort(abortReason))
      return new Promise<never>(() => {})
    })
    const transferCancel = vi.fn()
    const credentials = vi.fn().mockResolvedValue([{user: 'default'}])
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
    expect((cause?.cause as undefined | {details?: {endpoint?: string}})?.details?.endpoint).toBe(abortUrl)
    expect(serialized).toContain(abortUrl)
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
      .database.copyForApp('app-1', 'postgres://source.example/db', 'DATABASE_URL', {timeoutMs: 1000})
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
      .database.copyForApp('app-1', sourceUrl, 'DATABASE_URL', {
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

  it('aborts a pending credential lookup without creating a transfer', async () => {
    const controller = new AbortController()
    const credentials = vi.fn(() => new Promise<Array<{user: string}>>(() => {}))
    const transferCreate = vi.fn().mockResolvedValue({uuid: 'transfer-1'})
    const onCredentialsChecked = vi.fn()
    let lookupSignal: AbortSignal | undefined
    let startCredentialLookup!: () => void
    const credentialLookupStarted = new Promise<void>(resolve => {
      startCredentialLookup = resolve
    })
    const ctx = buildCtx({
      credentials,
      onRequest(request, signal) {
        if (request === 'credentials') {
          lookupSignal = signal
          startCredentialLookup()
        }
      },
      transferCreate,
    })

    const pendingCopy = copyDatabase(ctx, 'app-1', 'DATABASE_URL', 'postgres://target.example/db', {
      onCredentialsChecked,
      signal: controller.signal,
    }).catch((error: unknown) => error)
    await credentialLookupStarted
    controller.abort(new Error('cancel before transfer'))

    const error = await pendingCopy
    expect(error).toMatchObject({name: 'Error'})
    expect(controller.signal.aborted).toBe(true)
    expect(lookupSignal?.aborted).toBe(true)
    expect(transferCreate).not.toHaveBeenCalled()
    expect(onCredentialsChecked).not.toHaveBeenCalled()
  })

  it('returns async wait-start and poll callback failures settled with the transfer outcome', async () => {
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

    const result = await copyDatabase(ctx, 'app-1', 'postgres://source.example/db', 'DATABASE_URL', {onPoll, waitPoller})

    expect(result.transfer).toMatchObject({succeeded: true})
    expect(result.warnings.join('; ')).toContain('wait progress callback failed: async wait start failed')
    expect(result.warnings.join('; ')).toContain('transfer poll callback failed: async poll display failed')
    expect(result.warnings.join('; ')).not.toContain('async wait stop failed')
    expect(waitPoller.onStop).toHaveBeenCalledOnce()
  })

  it('reports a failing wait-poller stop hook without masking successful transfer completion', async () => {
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
    expect(result.warnings).toContain('wait progress callback failed: async wait stop failed')
    expect(infoByApp).toHaveBeenCalledOnce()
    expect(waitPoller.onStop).toHaveBeenCalledOnce()
  })

  it('keeps returned warnings stable when a progress callback rejects after transfer completion', async () => {
    let rejectCallback!: (reason: Error) => void
    const delayedCallback = new Promise<void>((_resolve, reject) => {
      rejectCallback = reject
    })
    const waitPoller = {onStart: vi.fn(() => delayedCallback), onStop: vi.fn()}
    const ctx = buildCtx()
    const unhandledRejections: unknown[] = []
    const onUnhandledRejection = (reason: unknown) => unhandledRejections.push(reason)
    process.on('unhandledRejection', onUnhandledRejection)

    try {
      const result = await copyDatabase(ctx, 'app-1', 'postgres://source.example/db', 'DATABASE_URL', {waitPoller})
      const warningSnapshot = [...result.warnings]
      rejectCallback(new Error('late progress callback failed'))
      await new Promise<void>(resolve => {
        setTimeout(resolve, 0)
      })

      expect(waitPoller.onStart).toHaveBeenCalledOnce()
      expect(result.warnings).toEqual(warningSnapshot)
      expect(result.warnings).not.toContain('wait progress callback failed: late progress callback failed')
      expect(unhandledRejections).toEqual([])
    } finally {
      process.off('unhandledRejection', onUnhandledRejection)
    }
  })

  it('exports the database copy transfer error from the public data barrel', () => {
    expect(PublicDatabaseCopyTransferError).toBe(DatabaseCopyTransferError)
  })

  it('uses a raw endpoint database pathname for confirmation, falling back to its hostname', async () => {
    const ctx = buildCtx()
    const beforeCopy = vi.fn()

    await copyDatabase(ctx, 'app-1', 'postgres://db.example.com:5432/my%20database', 'DATABASE_URL', {beforeCopy})
    expect(beforeCopy).toHaveBeenCalledWith(expect.objectContaining({
      source: expect.objectContaining({confirm: 'my%20database'}),
    }))

    const emptyPathBeforeCopy = vi.fn()
    await copyDatabase(ctx, 'app-1', 'postgres://db.example.com:5432', 'DATABASE_URL', {beforeCopy: emptyPathBeforeCopy})
    expect(emptyPathBeforeCopy).toHaveBeenCalledWith(expect.objectContaining({
      source: expect.objectContaining({confirm: 'db.example.com'}),
    }))
  })

  it('declares the data.database copy extension', () => {
    expect(databaseCopyExtensions.service).toBe('data')
    expect(databaseCopyExtensions.resource).toBe('database')
    expect(Object.keys(databaseCopyExtensions.factory({} as ResourceCtx))).toEqual(['copyForApp'])
  })
})
