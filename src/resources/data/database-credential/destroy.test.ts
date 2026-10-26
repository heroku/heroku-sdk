import {
  describe, expect, it, vi,
} from 'vitest'

import type {ResourceCtx} from '../../../core/extend-resource.js'

import {destroy} from './destroy.js'

function buildCtx(opts: {
  deleteCredential?: ReturnType<typeof vi.fn>
  listByAddOn?: ReturnType<typeof vi.fn>
  postgresCredentialDelete?: ReturnType<typeof vi.fn>
  postgresCredentialList?: ReturnType<typeof vi.fn>
  resolution?: ReturnType<typeof vi.fn>
}): Pick<ResourceCtx, 'data' | 'platform'> {
  const dataClient = {
    postgresCredential: {
      delete: opts.postgresCredentialDelete ?? vi.fn(),
      list: opts.postgresCredentialList ?? vi.fn(),
    },
    postgresDatabase: {
      deleteCredential: opts.deleteCredential ?? vi.fn(),
    },
    withOptions: vi.fn(() => dataClient),
  }

  return {
    data: dataClient as never,
    platform: {
      addOn: {
        resolution: opts.resolution ?? vi.fn(),
      },
      addOnAttachment: {
        listByAddOn: opts.listByAddOn ?? vi.fn().mockResolvedValue([]),
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

function buildAttachment(opts: {namespace?: null | string} = {}) {
  return {
    app: {id: 'app-2-uuid', name: 'other-app'},
    namespace: opts.namespace,
  }
}

describe('database credential destroy', () => {
  it('destroys an Advanced-tier credential via postgresCredential.delete', async () => {
    const addonMock = buildAddon({planName: 'heroku-postgresql:advanced-0'})
    const resolution = vi.fn().mockResolvedValue([addonMock])
    const postgresCredentialDelete = vi.fn()
    const ctx = buildCtx({
      postgresCredentialDelete,
      postgresCredentialList: vi.fn().mockResolvedValue({
        items: [{name: 'owner', type: 'owner'}, {name: 'reporting', type: 'additional'}],
      }),
      resolution,
    })

    const {addon, result} = await destroy(ctx, 'postgres-curved-12345', 'reporting')

    expect(postgresCredentialDelete).toHaveBeenCalledWith('addon-1', 'reporting')
    expect(result).toBeUndefined()
    expect(addon).toEqual(addonMock)
  })

  it('destroys a classic-tier credential via postgresDatabase.deleteCredential', async () => {
    const addonMock = buildAddon({planName: 'heroku-postgresql:standard-0'})
    const resolution = vi.fn().mockResolvedValue([addonMock])
    const deleteCredential = vi.fn().mockResolvedValue({message: 'destroyed'})
    const ctx = buildCtx({deleteCredential, resolution})

    const {addon, result} = await destroy(ctx, 'postgres-curved-12345', 'reporting')

    expect(deleteCredential).toHaveBeenCalledWith('addon-1', 'reporting')
    expect(result).toEqual({message: 'destroyed'})
    expect(addon).toEqual(addonMock)
  })

  it('throws when destroying the owner credential on the Advanced tier', async () => {
    const postgresCredentialDelete = vi.fn()
    const ctx = buildCtx({
      postgresCredentialDelete,
      postgresCredentialList: vi.fn().mockResolvedValue({items: [{name: 'reporting', type: 'owner'}]}),
      resolution: vi.fn().mockResolvedValue([buildAddon({planName: 'heroku-postgresql:advanced-0'})]),
    })

    await expect(destroy(ctx, 'postgres-curved-12345', 'reporting')).rejects.toThrow('You can\'t destroy the owner credential.')
    expect(postgresCredentialDelete).not.toHaveBeenCalled()
  })

  it('throws when destroying a custom credential on an Essential-tier database', async () => {
    const deleteCredential = vi.fn()
    const ctx = buildCtx({
      deleteCredential,
      resolution: vi.fn().mockResolvedValue([buildAddon({planName: 'heroku-postgresql:essential-0'})]),
    })

    await expect(destroy(ctx, 'postgres-curved-12345', 'reporting'))
      .rejects.toThrow('You can\'t destroy custom credentials on Essential-tier databases.')
    expect(deleteCredential).not.toHaveBeenCalled()
  })

  it('throws when destroying any credential on a legacy Essential-tier database', async () => {
    const deleteCredential = vi.fn()
    const ctx = buildCtx({
      deleteCredential,
      resolution: vi.fn().mockResolvedValue([buildAddon({planName: 'heroku-postgresql:dev'})]),
    })

    await expect(destroy(ctx, 'postgres-curved-12345', 'reporting'))
      .rejects.toThrow('You can\'t destroy the default credential.')
    expect(deleteCredential).not.toHaveBeenCalled()
  })

  it('throws when destroying the default credential on a classic-tier database', async () => {
    const deleteCredential = vi.fn().mockResolvedValue({})
    const ctx = buildCtx({
      deleteCredential,
      resolution: vi.fn().mockResolvedValue([buildAddon({planName: 'heroku-postgresql:standard-0'})]),
    })

    await expect(destroy(ctx, 'postgres-curved-12345', 'default'))
      .rejects.toThrow('You can\'t destroy the default credential.')
    expect(deleteCredential).not.toHaveBeenCalled()
  })

  it('throws when the credential is still attached to an app on the Advanced tier', async () => {
    const postgresCredentialDelete = vi.fn()
    const ctx = buildCtx({
      listByAddOn: vi.fn().mockResolvedValue([buildAttachment({namespace: 'role:reporting'})]),
      postgresCredentialDelete,
      postgresCredentialList: vi.fn().mockResolvedValue({
        items: [{name: 'owner', type: 'owner'}, {name: 'reporting', type: 'additional'}],
      }),
      resolution: vi.fn().mockResolvedValue([buildAddon({planName: 'heroku-postgresql:advanced-0'})]),
    })

    await expect(destroy(ctx, 'postgres-curved-12345', 'reporting'))
      .rejects.toThrow('You must detach the credential reporting from the app other-app before destroying it.')
    expect(postgresCredentialDelete).not.toHaveBeenCalled()
  })

  it('throws when the credential is still attached to an app on the classic tier', async () => {
    const deleteCredential = vi.fn().mockResolvedValue({})
    const ctx = buildCtx({
      deleteCredential,
      listByAddOn: vi.fn().mockResolvedValue([buildAttachment({namespace: 'credential:reporting'})]),
      resolution: vi.fn().mockResolvedValue([buildAddon({planName: 'heroku-postgresql:standard-0'})]),
    })

    await expect(destroy(ctx, 'postgres-curved-12345', 'reporting'))
      .rejects.toThrow('You must detach the credential reporting from the app other-app before destroying it.')
    expect(deleteCredential).not.toHaveBeenCalled()
  })

  it('pluralizes the error message when the credential is attached to multiple apps', async () => {
    const deleteCredential = vi.fn()
    const ctx = buildCtx({
      deleteCredential,
      listByAddOn: vi.fn().mockResolvedValue([
        buildAttachment({namespace: 'credential:reporting'}),
        {app: {id: 'app-3-uuid', name: 'third-app'}, namespace: 'credential:reporting'},
      ]),
      resolution: vi.fn().mockResolvedValue([buildAddon({planName: 'heroku-postgresql:standard-0'})]),
    })

    await expect(destroy(ctx, 'postgres-curved-12345', 'reporting'))
      .rejects.toThrow('You must detach the credential reporting from the apps other-app, third-app before destroying it.')
    expect(deleteCredential).not.toHaveBeenCalled()
  })

  it('scopes resolution by appIdentity when given', async () => {
    const resolution = vi.fn().mockResolvedValue([buildAddon({planName: 'heroku-postgresql:standard-0'})])
    const ctx = buildCtx({
      deleteCredential: vi.fn().mockResolvedValue({message: 'destroyed'}),
      resolution,
    })

    await destroy(ctx, 'DATABASE_URL', 'reporting', {appIdentity: 'app-1'})

    expect(resolution).toHaveBeenCalledWith({addon: 'DATABASE_URL', app: 'app-1'})
  })

  it('binds the signal to the data client so the request aborts in flight', async () => {
    const ctx = buildCtx({
      deleteCredential: vi.fn().mockResolvedValue({}),
      resolution: vi.fn().mockResolvedValue([buildAddon({planName: 'heroku-postgresql:standard-0'})]),
    })
    const controller = new AbortController()

    await destroy(ctx, 'postgres-curved-12345', 'reporting', {signal: controller.signal})

    expect(ctx.data.withOptions).toHaveBeenCalledWith({signal: controller.signal})
  })

  it('throws if signal is aborted', async () => {
    const ctx = buildCtx({})
    const controller = new AbortController()
    controller.abort()

    await expect(destroy(ctx, 'postgres-curved-12345', 'reporting', {signal: controller.signal})).rejects.toThrow()
  })
})
