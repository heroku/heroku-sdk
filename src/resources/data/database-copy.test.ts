/* eslint-disable camelcase */
import {
  describe, expect, it, vi,
} from 'vitest'

import type {ResourceCtx} from '../../core/extend-resource.js'

import {legacyResourceCtx} from '../../../test-types/heroku-sdk-options.js'
import {copyDatabase, databaseCopyExtensions} from './database-copy.js'
import {TransferFailedError} from './transfer/wait-for-transfer.js'

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
  resolution?: ReturnType<typeof vi.fn>
  transferCreate?: ReturnType<typeof vi.fn>
} = {}): ResourceCtx {
  const transfer = {
    create: opts.transferCreate ?? vi.fn().mockResolvedValue({uuid: 'transfer-1'}),
    infoByApp: opts.infoByApp ?? vi.fn().mockResolvedValue({finished_at: 'now', succeeded: true, uuid: 'transfer-1'}),
  }
  const data: Record<string, unknown> = {
    postgresDatabase: {
      listCredentials: opts.credentials ?? vi.fn().mockResolvedValue([{user: 'default'}, {user: 'extra'}]),
    },
    transfer,
  }
  data.withOptions = vi.fn(() => data)

  return {
    ...legacyResourceCtx,
    data: data as never,
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

describe('database copy resource', () => {
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
    expect(result.source.url).toBe('postgres://heroku/database')
  })

  it('resolves config-var values case-insensitively using the attachment URL config var', async () => {
    const ctx = buildCtx();
    (ctx.platform as never as {configVar: {infoForApp: ReturnType<typeof vi.fn>}}).configVar.infoForApp
      .mockResolvedValue({database_url: 'postgres://heroku/lowercase'})

    const result = await copyDatabase(ctx, 'app-1', 'DATABASE_URL', 'postgres://target.example/db')

    expect(result.source.url).toBe('postgres://heroku/lowercase')
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

    expect(result.source.url).toBe('postgres://heroku/default')
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
    expect(order).toEqual(['create', 'credentials', 'poll'])
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
    expect(credentialGet).toHaveBeenCalledWith('/postgres/v0/databases/postgres-1/credentials', {signal: undefined})
    expect(credentials).not.toHaveBeenCalled()
    expect(transferCreate).toHaveBeenCalledOnce()
    expect(infoByApp).toHaveBeenCalledOnce()
    expect(order).toEqual(['create', 'credentials', 'poll'])
    expect(result.credentialCount).toBe(2)
  })

  it('encodes add-on names in the optional credential lookup path', async () => {
    const attachment = {...pgAttachment, addon: {...pgAttachment.addon, name: 'postgres/name ?'}}
    const resolution = vi.fn().mockResolvedValue([attachment])
    const credentialGet = vi.fn().mockResolvedValue({json: async () => [{user: 'default'}]})
    const makeClient = vi.fn().mockReturnValue({get: credentialGet})
    const ctx = buildCtx({makeClient, resolution})

    await copyDatabase(ctx, 'app-1', 'DATABASE_URL', 'postgres://target.example/db', {credentialToken: 'token'})

    expect(credentialGet).toHaveBeenCalledWith('/postgres/v0/databases/postgres%2Fname%20%3F/credentials', {signal: undefined})
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
    const ctx = buildCtx({infoByApp})

    const error = await copyDatabase(ctx, 'app-1', 'postgres://source.example/db', 'DATABASE_URL')
      .catch((error_: unknown) => error_)

    expect(error).toBeInstanceOf(TransferFailedError)
    expect((error as TransferFailedError).name).toBe('TransferFailedError')
    expect((error as TransferFailedError).message).toBe('An error occurred and the transfer did not finish.')
    expect((error as TransferFailedError).body).toEqual({id: 'transfer_failed', message: 'An error occurred and the transfer did not finish.'})
    expect((error as TransferFailedError).transfer).toEqual(verboseTransfer)
    expect((error as TransferFailedError).transfer.logs).toEqual(verboseTransfer.logs)
    expect(infoByApp).toHaveBeenCalledTimes(2)
    expect(infoByApp).toHaveBeenNthCalledWith(1, 'app-1', 'transfer-1', {verbose: undefined})
    expect(infoByApp).toHaveBeenNthCalledWith(2, 'app-1', 'transfer-1', {verbose: true})
  })

  it('declares the data.database copy extension', () => {
    expect(databaseCopyExtensions.service).toBe('data')
    expect(databaseCopyExtensions.resource).toBe('database')
    expect(Object.keys(databaseCopyExtensions.factory({} as ResourceCtx))).toEqual(['copy'])
  })
})
