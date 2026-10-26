import {
  describe, expect, it, vi,
} from 'vitest'

import type {ResourceCtx} from '../../../core/extend-resource.js'

import {list, NotAdvancedDatabaseError} from './list.js'

function buildCtx(opts: {
  postgresCredentialList?: ReturnType<typeof vi.fn>
  resolution?: ReturnType<typeof vi.fn>
}): Pick<ResourceCtx, 'data' | 'platform'> {
  const dataClient = {
    postgresCredential: {
      list: opts.postgresCredentialList ?? vi.fn(),
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

describe('database credential list', () => {
  it('lists Advanced-tier credentials via postgresCredential.list', async () => {
    const addonMock = buildAddon({planName: 'heroku-postgresql:advanced-0'})
    const resolution = vi.fn().mockResolvedValue([addonMock])
    const postgresCredentialList = vi.fn().mockResolvedValue({items: [{name: 'owner', type: 'owner'}]})
    const ctx = buildCtx({postgresCredentialList, resolution})

    const {addon, credentials} = await list(ctx, 'postgres-curved-12345')

    expect(postgresCredentialList).toHaveBeenCalledWith('addon-1')
    expect(credentials).toEqual({items: [{name: 'owner', type: 'owner'}]})
    expect(addon).toEqual(addonMock)
  })

  it('throws NotAdvancedDatabaseError with the resolved addon for classic-tier databases', async () => {
    const addonMock = buildAddon({planName: 'heroku-postgresql:standard-0'})
    const ctx = buildCtx({resolution: vi.fn().mockResolvedValue([addonMock])})

    const error = await list(ctx, 'postgres-curved-12345').catch((error_: unknown) => error_)

    expect(error).toBeInstanceOf(NotAdvancedDatabaseError)
    expect((error as NotAdvancedDatabaseError).addon).toEqual(addonMock)
  })

  it('scopes resolution by appIdentity when given', async () => {
    const resolution = vi.fn().mockResolvedValue([buildAddon({planName: 'heroku-postgresql:advanced-0'})])
    const ctx = buildCtx({
      postgresCredentialList: vi.fn().mockResolvedValue({items: []}),
      resolution,
    })

    await list(ctx, 'DATABASE_URL', {appIdentity: 'app-1'})

    expect(resolution).toHaveBeenCalledWith({addon: 'DATABASE_URL', app: 'app-1'})
  })

  it('binds the signal to the data client so the request aborts in flight', async () => {
    const ctx = buildCtx({
      postgresCredentialList: vi.fn().mockResolvedValue({items: []}),
      resolution: vi.fn().mockResolvedValue([buildAddon({planName: 'heroku-postgresql:advanced-0'})]),
    })
    const controller = new AbortController()

    await list(ctx, 'postgres-curved-12345', {signal: controller.signal})

    expect(ctx.data.withOptions).toHaveBeenCalledWith({signal: controller.signal})
  })

  it('throws if signal is aborted', async () => {
    const ctx = buildCtx({})
    const controller = new AbortController()
    controller.abort()

    await expect(list(ctx, 'postgres-curved-12345', {signal: controller.signal})).rejects.toThrow()
  })
})
