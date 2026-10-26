import {
  describe, expect, it, vi,
} from 'vitest'

import type {ResourceCtx} from '../../../core/extend-resource.js'

import {getUrl} from './get-url.js'

function buildCtx(opts: {
  infoCredential?: ReturnType<typeof vi.fn>
  postgresCredentialInfo?: ReturnType<typeof vi.fn>
  postgresCredentialList?: ReturnType<typeof vi.fn>
  resolution?: ReturnType<typeof vi.fn>
}): Pick<ResourceCtx, 'data' | 'platform'> {
  const dataClient = {
    postgresCredential: {
      info: opts.postgresCredentialInfo ?? vi.fn(),
      list: opts.postgresCredentialList ?? vi.fn(),
    },
    postgresDatabase: {
      infoCredential: opts.infoCredential ?? vi.fn(),
    },
    withOptions: vi.fn(() => dataClient),
  }

  return {
    data: dataClient as never,
    platform: {
      addOn: {
        resolution: opts.resolution ?? vi.fn(),
      },
      withHeaders() {
        return this
      },
      withOptions() {
        return this
      },
    } as never,
  }
}

function buildAddon(opts: {planName: string}) {
  return {
    // eslint-disable-next-line camelcase
    addon_service: {name: 'heroku-postgresql'},
    app: {id: 'app-uuid', name: 'app-1'},
    id: 'addon-1',
    name: 'pg-addon',
    plan: {name: opts.planName},
  }
}

describe('database credential getUrl', () => {
  it('defaults to the owner credential on the Advanced tier', async () => {
    const addonMock = buildAddon({planName: 'heroku-postgresql:advanced-0'})
    const resolution = vi.fn().mockResolvedValue([addonMock])
    const postgresCredentialList = vi.fn().mockResolvedValue({items: [{name: 'owner-cred', type: 'owner'}]})
    const postgresCredentialInfo = vi.fn().mockResolvedValue({
      database: 'db', host: 'host.example.com', port: 5432, roles: [{password: 'secret', state: 'active', user: 'owner-cred'}],
    })
    const ctx = buildCtx({postgresCredentialInfo, postgresCredentialList, resolution})

    const {addon, credentialConnectionInfo} = await getUrl(ctx, 'postgres-curved-12345')

    expect(postgresCredentialList).toHaveBeenCalledWith('addon-1')
    expect(postgresCredentialInfo).toHaveBeenCalledWith('addon-1', 'owner-cred')
    expect(credentialConnectionInfo).toEqual({
      credName: 'owner-cred',
      database: 'db',
      host: 'host.example.com',
      password: 'secret',
      port: 5432,
      url: 'postgres://owner-cred:secret@host.example.com:5432/db',
      user: 'owner-cred',
    })
    expect(addon).toEqual(addonMock)
  })

  it('uses the named credential on the Advanced tier when given', async () => {
    const postgresCredentialList = vi.fn()
    const postgresCredentialInfo = vi.fn().mockResolvedValue({
      database: 'db', host: 'host.example.com', port: 5432, roles: [{password: 'secret', state: 'active', user: 'reporting'}],
    })
    const ctx = buildCtx({
      postgresCredentialInfo,
      postgresCredentialList,
      resolution: vi.fn().mockResolvedValue([buildAddon({planName: 'heroku-postgresql:advanced-0'})]),
    })

    const {credentialConnectionInfo} = await getUrl(ctx, 'postgres-curved-12345', 'reporting')

    expect(postgresCredentialList).not.toHaveBeenCalled()
    expect(postgresCredentialInfo).toHaveBeenCalledWith('addon-1', 'reporting')
    expect(credentialConnectionInfo.credName).toEqual('reporting')
  })

  it('throws when the resolved credential is not active', async () => {
    const ctx = buildCtx({
      postgresCredentialInfo: vi.fn().mockResolvedValue({
        database: 'db', host: 'host.example.com', port: 5432, roles: [],
      }),
      postgresCredentialList: vi.fn().mockResolvedValue({items: [{name: 'owner-cred', type: 'owner'}]}),
      resolution: vi.fn().mockResolvedValue([buildAddon({planName: 'heroku-postgresql:advanced-0'})]),
    })

    await expect(getUrl(ctx, 'postgres-curved-12345'))
      .rejects.toThrow('The credential owner-cred isn\'t active on the database pg-addon.')
  })

  it('throws when no active credentials are found on the Advanced tier', async () => {
    const postgresCredentialInfo = vi.fn()
    const ctx = buildCtx({
      postgresCredentialInfo,
      postgresCredentialList: vi.fn().mockResolvedValue({items: [{name: 'reporting', type: 'additional'}]}),
      resolution: vi.fn().mockResolvedValue([buildAddon({planName: 'heroku-postgresql:advanced-0'})]),
    })

    await expect(getUrl(ctx, 'postgres-curved-12345'))
      .rejects.toThrow('There are no active credentials on the database pg-addon.')
    expect(postgresCredentialInfo).not.toHaveBeenCalled()
  })

  it('throws when the resolved credential is not active on the classic tier', async () => {
    const ctx = buildCtx({
      infoCredential: vi.fn().mockResolvedValue({
        credentials: [], database: 'db', host: 'host.example.com', port: 5432,
      }),
      resolution: vi.fn().mockResolvedValue([buildAddon({planName: 'heroku-postgresql:standard-0'})]),
    })

    await expect(getUrl(ctx, 'postgres-curved-12345'))
      .rejects.toThrow('The credential default isn\'t active on the database pg-addon.')
  })

  it('defaults to the default credential on the classic tier', async () => {
    const addonMock = buildAddon({planName: 'heroku-postgresql:standard-0'})
    const infoCredential = vi.fn().mockResolvedValue({
      credentials: [{password: 'secret', state: 'active', user: 'default'}], database: 'db', host: 'host.example.com', port: 5432,
    })
    const ctx = buildCtx({
      infoCredential,
      resolution: vi.fn().mockResolvedValue([addonMock]),
    })

    const {addon, credentialConnectionInfo} = await getUrl(ctx, 'postgres-curved-12345')

    expect(infoCredential).toHaveBeenCalledWith('addon-1', 'default')
    expect(credentialConnectionInfo).toEqual({
      credName: 'default',
      database: 'db',
      host: 'host.example.com',
      password: 'secret',
      port: 5432,
      url: 'postgres://default:secret@host.example.com:5432/db',
      user: 'default',
    })
    expect(addon).toEqual(addonMock)
  })

  it('scopes resolution by appIdentity when given', async () => {
    const resolution = vi.fn().mockResolvedValue([buildAddon({planName: 'heroku-postgresql:standard-0'})])
    const ctx = buildCtx({
      infoCredential: vi.fn().mockResolvedValue({
        credentials: [{password: 'secret', state: 'active', user: 'default'}], database: 'db', host: 'host.example.com', port: 5432,
      }),
      resolution,
    })

    await getUrl(ctx, 'DATABASE_URL', undefined, {appIdentity: 'app-1'})

    expect(resolution).toHaveBeenCalledWith({addon: 'DATABASE_URL', app: 'app-1'})
  })

  it('binds the signal to the data client so the request aborts in flight', async () => {
    const ctx = buildCtx({
      infoCredential: vi.fn().mockResolvedValue({
        credentials: [{password: 'secret', state: 'active', user: 'default'}], database: 'db', host: 'host.example.com', port: 5432,
      }),
      resolution: vi.fn().mockResolvedValue([buildAddon({planName: 'heroku-postgresql:standard-0'})]),
    })
    const controller = new AbortController()

    await getUrl(ctx, 'postgres-curved-12345', undefined, {signal: controller.signal})

    expect(ctx.data.withOptions).toHaveBeenCalledWith({signal: controller.signal})
  })

  it('throws if signal is aborted', async () => {
    const ctx = buildCtx({})
    const controller = new AbortController()
    controller.abort()

    await expect(getUrl(ctx, 'postgres-curved-12345', undefined, {signal: controller.signal})).rejects.toThrow()
  })

  it('throws when a named credential is requested on an Essential-tier database', async () => {
    const infoCredential = vi.fn()
    const ctx = buildCtx({
      infoCredential,
      resolution: vi.fn().mockResolvedValue([buildAddon({planName: 'heroku-postgresql:essential-0'})]),
    })

    await expect(getUrl(ctx, 'postgres-curved-12345', 'reporting'))
      .rejects.toThrow('Essential-tier databases don\'t support named credentials.')
    expect(infoCredential).not.toHaveBeenCalled()
  })

  it('allows the default credential on an Essential-tier database', async () => {
    const infoCredential = vi.fn().mockResolvedValue({
      credentials: [{password: 'secret', state: 'active', user: 'default'}], database: 'db', host: 'host.example.com', port: 5432,
    })
    const ctx = buildCtx({
      infoCredential,
      resolution: vi.fn().mockResolvedValue([buildAddon({planName: 'heroku-postgresql:essential-0'})]),
    })

    await getUrl(ctx, 'postgres-curved-12345', 'default')

    expect(infoCredential).toHaveBeenCalledWith('addon-1', 'default')
  })
})
