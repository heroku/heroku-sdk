import {
  describe, expect, it, vi,
} from 'vitest'

import type {ResourceCtx} from '../../../core/extend-resource.js'

import {rotate} from './rotate.js'

function buildCtx(opts: {
  listByAddOn?: ReturnType<typeof vi.fn>
  listCredentials?: ReturnType<typeof vi.fn>
  postgresCredentialList?: ReturnType<typeof vi.fn>
  postgresCredentialRotate?: ReturnType<typeof vi.fn>
  postgresRotateCredentials?: ReturnType<typeof vi.fn>
  resolution?: ReturnType<typeof vi.fn>
  rotateCredential?: ReturnType<typeof vi.fn>
  rotateCredentials?: ReturnType<typeof vi.fn>
}): Pick<ResourceCtx, 'data' | 'platform'> {
  const dataClient = {
    postgres: {
      rotateCredentials: opts.postgresRotateCredentials ?? vi.fn(),
    },
    postgresCredential: {
      list: opts.postgresCredentialList ?? vi.fn(),
      rotate: opts.postgresCredentialRotate ?? vi.fn(),
    },
    postgresDatabase: {
      listCredentials: opts.listCredentials ?? vi.fn(),
      rotateCredential: opts.rotateCredential ?? vi.fn(),
      rotateCredentials: opts.rotateCredentials ?? vi.fn(),
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

describe('database credential rotate', () => {
  it('rotates all Advanced-tier credentials via postgres.rotateCredentials', async () => {
    const addonMock = buildAddon({planName: 'heroku-postgresql:advanced-0'})
    const resolution = vi.fn().mockResolvedValue([addonMock])
    const postgresRotateCredentials = vi.fn().mockResolvedValue({message: 'rotating'})
    const ctx = buildCtx({
      postgresCredentialList: vi.fn().mockResolvedValue({items: [{name: 'owner', type: 'owner'}]}),
      postgresRotateCredentials,
      resolution,
    })

    const result = await rotate(ctx, 'postgres-curved-12345', {all: true, forced: true})

    expect(postgresRotateCredentials).toHaveBeenCalledWith('addon-1', {forced: true})
    expect(result.credentials).toEqual({message: 'rotating'})
    expect(result.addon).toEqual(addonMock)
  })

  it('rotates all classic-tier credentials via postgresDatabase.rotateCredentials', async () => {
    const rotateCredentials = vi.fn().mockResolvedValue({message: 'rotating'})
    const ctx = buildCtx({
      listCredentials: vi.fn().mockResolvedValue([{name: 'default'}]),
      resolution: vi.fn().mockResolvedValue([buildAddon({planName: 'heroku-postgresql:standard-0'})]),
      rotateCredentials,
    })

    await rotate(ctx, 'postgres-curved-12345', {all: true})

    expect(rotateCredentials).toHaveBeenCalledWith('addon-1', {forced: undefined})
  })

  it('rotates a specific Advanced-tier credential via postgresCredential.rotate', async () => {
    const postgresCredentialRotate = vi.fn()
    const ctx = buildCtx({
      postgresCredentialList: vi.fn().mockResolvedValue({
        items: [{name: 'owner', type: 'owner'}, {name: 'reporting', type: 'additional'}],
      }),
      postgresCredentialRotate,
      resolution: vi.fn().mockResolvedValue([buildAddon({planName: 'heroku-postgresql:advanced-0'})]),
    })

    await rotate(ctx, 'postgres-curved-12345', {credName: 'reporting'})

    expect(postgresCredentialRotate).toHaveBeenCalledWith('addon-1', 'reporting', {forced: undefined})
  })

  it('rotates a specific classic-tier credential via postgresDatabase.rotateCredential', async () => {
    const addonMock = buildAddon({planName: 'heroku-postgresql:standard-0'})
    const resolution = vi.fn().mockResolvedValue([addonMock])
    const rotateCredential = vi.fn().mockResolvedValue({message: 'rotated'})
    const ctx = buildCtx({
      listCredentials: vi.fn().mockResolvedValue([{name: 'default'}]),
      resolution,
      rotateCredential,
    })

    const result = await rotate(ctx, 'postgres-curved-12345', {credName: 'default', forced: true})

    expect(rotateCredential).toHaveBeenCalledWith('addon-1', 'default', {forced: true})
    expect(result.credential).toEqual({message: 'rotated'})
    expect(result.addon).toEqual(addonMock)
  })

  it('throws when there are no credentials on the database', async () => {
    const rotateCredential = vi.fn()
    const ctx = buildCtx({
      listCredentials: vi.fn().mockResolvedValue([]),
      resolution: vi.fn().mockResolvedValue([buildAddon({planName: 'heroku-postgresql:standard-0'})]),
      rotateCredential,
    })

    await expect(rotate(ctx, 'postgres-curved-12345')).rejects.toThrow('There are no credentials on the database pg-addon.')
    expect(rotateCredential).not.toHaveBeenCalled()
  })

  it('throws when rotating a named credential on a legacy Essential-tier database', async () => {
    const rotateCredential = vi.fn()
    const ctx = buildCtx({
      resolution: vi.fn().mockResolvedValue([buildAddon({planName: 'heroku-postgresql:dev'})]),
      rotateCredential,
    })

    await expect(rotate(ctx, 'postgres-curved-12345', {credName: 'reporting'}))
      .rejects.toThrow('Legacy Essential-tier databases do not support named credentials.')
    expect(rotateCredential).not.toHaveBeenCalled()
  })

  it('throws when rotating a named credential on an Essential-tier database', async () => {
    const rotateCredential = vi.fn()
    const ctx = buildCtx({
      resolution: vi.fn().mockResolvedValue([buildAddon({planName: 'heroku-postgresql:essential-0'})]),
      rotateCredential,
    })

    await expect(rotate(ctx, 'postgres-curved-12345', {credName: 'reporting'}))
      .rejects.toThrow('Essential-tier databases do not support named credentials.')
    expect(rotateCredential).not.toHaveBeenCalled()
  })

  it('scopes resolution by appIdentity when given', async () => {
    const resolution = vi.fn().mockResolvedValue([buildAddon({planName: 'heroku-postgresql:standard-0'})])
    const ctx = buildCtx({
      listCredentials: vi.fn().mockResolvedValue([{name: 'default'}]),
      resolution,
      rotateCredential: vi.fn().mockResolvedValue({message: 'rotated'}),
    })

    await rotate(ctx, 'DATABASE_URL', {credName: 'default'}, {appIdentity: 'app-1'})

    expect(resolution).toHaveBeenCalledWith({addon: 'DATABASE_URL', app: 'app-1'})
  })

  it('binds the signal to the data client so the request aborts in flight', async () => {
    const ctx = buildCtx({
      listCredentials: vi.fn().mockResolvedValue([{name: 'default'}]),
      resolution: vi.fn().mockResolvedValue([buildAddon({planName: 'heroku-postgresql:standard-0'})]),
      rotateCredential: vi.fn().mockResolvedValue({}),
    })
    const controller = new AbortController()

    await rotate(ctx, 'postgres-curved-12345', {credName: 'default'}, {signal: controller.signal})

    expect(ctx.data.withOptions).toHaveBeenCalledWith({signal: controller.signal})
  })

  it('throws if signal is aborted', async () => {
    const ctx = buildCtx({})
    const controller = new AbortController()
    controller.abort()

    await expect(rotate(ctx, 'postgres-curved-12345', {all: true}, {signal: controller.signal})).rejects.toThrow()
  })

  it('fires beforeRotate with the preview before rotating', async () => {
    const rotateCredential = vi.fn().mockResolvedValue({})
    const attachment = buildAttachment()
    const credential = {name: 'default'}
    const addonMock = buildAddon({planName: 'heroku-postgresql:standard-0'})
    const ctx = buildCtx({
      listByAddOn: vi.fn().mockResolvedValue([attachment]),
      listCredentials: vi.fn().mockResolvedValue([credential]),
      resolution: vi.fn().mockResolvedValue([addonMock]),
      rotateCredential,
    })
    const beforeRotate = vi.fn()

    await rotate(ctx, 'postgres-curved-12345', {credName: 'default'}, {beforeRotate})

    expect(beforeRotate).toHaveBeenCalledWith({
      addon: addonMock,
      attachments: [attachment],
      credToRotate: credential,
      defaultCred: credential,
      isAdvancedTier: false,
      isEssentialTier: false,
      ownerCred: undefined,
    })
    expect(beforeRotate.mock.invocationCallOrder[0]).toBeLessThan(rotateCredential.mock.invocationCallOrder[0])
  })

  it('throws before rotating when beforeRotate throws', async () => {
    const rotateCredential = vi.fn().mockResolvedValue({})
    const ctx = buildCtx({
      listCredentials: vi.fn().mockResolvedValue([{name: 'default'}]),
      resolution: vi.fn().mockResolvedValue([buildAddon({planName: 'heroku-postgresql:standard-0'})]),
      rotateCredential,
    })
    const beforeRotate = vi.fn().mockRejectedValue(new Error('declined'))

    await expect(rotate(ctx, 'postgres-curved-12345', {credName: 'default'}, {beforeRotate})).rejects.toThrow('declined')
    expect(rotateCredential).not.toHaveBeenCalled()
  })

  it('throws after beforeRotate if the signal is aborted', async () => {
    const rotateCredential = vi.fn().mockResolvedValue({})
    const controller = new AbortController()
    const ctx = buildCtx({
      listCredentials: vi.fn().mockResolvedValue([{name: 'default'}]),
      resolution: vi.fn().mockResolvedValue([buildAddon({planName: 'heroku-postgresql:standard-0'})]),
      rotateCredential,
    })
    const beforeRotate = vi.fn(() => controller.abort())

    await expect(rotate(ctx, 'postgres-curved-12345', {credName: 'default'}, {beforeRotate, signal: controller.signal}))
      .rejects.toThrow()
    expect(rotateCredential).not.toHaveBeenCalled()
  })
})
