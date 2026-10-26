import {
  describe, expect, it, vi,
} from 'vitest'

import type {ResourceCtx} from '../../../core/extend-resource.js'

import {create} from './create.js'

function buildCtx(opts: {
  createCredentials?: ReturnType<typeof vi.fn>
  postgresCredentialCreate?: ReturnType<typeof vi.fn>
  resolution?: ReturnType<typeof vi.fn>
}): Pick<ResourceCtx, 'data' | 'platform'> {
  const dataClient = {
    postgresCredential: {
      create: opts.postgresCredentialCreate ?? vi.fn(),
    },
    postgresDatabase: {
      createCredentials: opts.createCredentials ?? vi.fn(),
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

describe('database credential create', () => {
  it('creates an Advanced-tier credential via postgresCredential.create', async () => {
    const addonMock = buildAddon({planName: 'heroku-postgresql:advanced-0'})
    const resolution = vi.fn().mockResolvedValue([addonMock])
    const postgresCredentialCreate = vi.fn().mockResolvedValue({id: 'cred-1', name: 'reporting'})
    const ctx = buildCtx({postgresCredentialCreate, resolution})

    const {addon, credential} = await create(ctx, 'postgres-curved-12345', {name: 'reporting'})

    expect(postgresCredentialCreate).toHaveBeenCalledWith('addon-1', {name: 'reporting'})
    expect(credential).toEqual({id: 'cred-1', name: 'reporting'})
    expect(addon).toEqual(addonMock)
  })

  it('creates a classic-tier credential via postgresDatabase.createCredentials', async () => {
    const addonMock = buildAddon({planName: 'heroku-postgresql:standard-0'})
    const resolution = vi.fn().mockResolvedValue([addonMock])
    const createCredentials = vi.fn().mockResolvedValue({message: 'created'})
    const ctx = buildCtx({createCredentials, resolution})

    const {addon, credential} = await create(ctx, 'postgres-curved-12345', {name: 'reporting'})

    expect(createCredentials).toHaveBeenCalledWith('addon-1', {name: 'reporting'})
    expect(credential).toEqual({message: 'created'})
    expect(addon).toEqual(addonMock)
  })

  it('scopes resolution by appIdentity when given', async () => {
    const resolution = vi.fn().mockResolvedValue([buildAddon({planName: 'heroku-postgresql:standard-0'})])
    const ctx = buildCtx({
      createCredentials: vi.fn().mockResolvedValue({message: 'created'}),
      resolution,
    })

    await create(ctx, 'DATABASE_URL', {name: 'reporting'}, {appIdentity: 'app-1'})

    expect(resolution).toHaveBeenCalledWith({addon: 'DATABASE_URL', app: 'app-1'})
  })

  it('binds the signal to the data client so the request aborts in flight', async () => {
    const ctx = buildCtx({
      createCredentials: vi.fn().mockResolvedValue({}),
      resolution: vi.fn().mockResolvedValue([buildAddon({planName: 'heroku-postgresql:standard-0'})]),
    })
    const controller = new AbortController()

    await create(ctx, 'postgres-curved-12345', {name: 'reporting'}, {signal: controller.signal})

    expect(ctx.data.withOptions).toHaveBeenCalledWith({signal: controller.signal})
  })

  it('throws if signal is aborted', async () => {
    const ctx = buildCtx({})
    const controller = new AbortController()
    controller.abort()

    await expect(create(ctx, 'postgres-curved-12345', {name: 'reporting'}, {signal: controller.signal})).rejects.toThrow()
  })

  it('throws when creating a credential on an Essential-tier database', async () => {
    const ctx = buildCtx({
      resolution: vi.fn().mockResolvedValue([buildAddon({planName: 'heroku-postgresql:essential-0'})]),
    })

    await expect(create(ctx, 'postgres-curved-12345', {name: 'reporting'}))
      .rejects.toThrow('You can\'t create custom credentials on Essential-tier databases.')
  })

  it('throws when creating a credential on a legacy Essential-tier database', async () => {
    const ctx = buildCtx({
      resolution: vi.fn().mockResolvedValue([buildAddon({planName: 'heroku-postgresql:dev'})]),
    })

    await expect(create(ctx, 'postgres-curved-12345', {name: 'reporting'}))
      .rejects.toThrow('You can\'t create custom credentials on Essential-tier databases.')
  })
})
