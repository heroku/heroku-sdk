import {HerokuApiError} from '@heroku/heroku-fetch'
import {
  describe, expect, it, vi,
} from 'vitest'

import type {ResourceCtx} from '../../core/extend-resource.js'

import {AddonConfirmationRequiredError, AddonNotFoundError} from '../platform/add-on/errors.js'
import {getPostgresServiceName, NotAdvancedDatabaseError} from './internal/postgres-utils.js'
import {
  createAttachment, deleteAttachment, listCredentials, postgresDatabaseExtensions,
} from './postgres-database.js'

function buildCtx(opts: {
  addonResolution?: ReturnType<typeof vi.fn>
  createAttachment?: ReturnType<typeof vi.fn>
  deleteAttachment?: ReturnType<typeof vi.fn>
  infoByApp?: ReturnType<typeof vi.fn>
  list?: ReturnType<typeof vi.fn>
  releaseList?: ReturnType<typeof vi.fn>
  resolutionByAttachment?: ReturnType<typeof vi.fn>
} = {}): Pick<ResourceCtx, 'data' | 'platform'> {
  const data: Record<string, unknown> = {
    postgresDatabase: {listCredentials: opts.list ?? vi.fn()},
  }
  // Self-referential so a `.withOptions({signal})` chain resolves back to data.
  data.withOptions = vi.fn(() => data)

  return {
    data: data as never,
    platform: {
      addOn: {resolution: opts.addonResolution ?? vi.fn()},
      addOnAttachment: {
        create: opts.createAttachment ?? vi.fn(),
        delete: opts.deleteAttachment ?? vi.fn(),
        infoByApp: opts.infoByApp ?? vi.fn(),
        resolution: opts.resolutionByAttachment ?? vi.fn(),
      },
      release: {list: opts.releaseList ?? vi.fn().mockResolvedValue([{version: 1}])},
      withHeaders() {
        return this
      },
      withOptions() {
        return this
      },
    } as never,
  }
}

function buildAttachment(opts: {addonId?: string; addonName?: string} = {}) {
  return {
    addon: {
      app: {id: 'app-uuid', name: 'app-1'},
      id: opts.addonId ?? 'addon-1',
      name: opts.addonName ?? 'pg-addon',
    },
    app: {id: 'app-uuid', name: 'app-1'},
    id: 'attachment-1',
    name: 'DATABASE',
  }
}

function buildAddon(opts: {id?: string; planName: string}) {
  return {
    // eslint-disable-next-line camelcase
    addon_service: {name: getPostgresServiceName()},
    app: {id: 'app-uuid', name: 'app-1'},
    id: opts.id ?? 'addon-1',
    name: 'pg-addon',
    plan: {name: opts.planName},
  }
}

describe('postgres-database resource', () => {
  it('listCredentials resolves the addon and calls postgresDatabase.listCredentials', async () => {
    const resolutionByAttachment = vi.fn().mockResolvedValue([
      {
        addon: {
          app: {id: 'app-uuid', name: 'app-1'},
          id: 'addon-x',
          name: 'pg-attached',
          plan: {name: 'heroku-postgresql:essential-0'},
        },
        app: {id: 'app-uuid', name: 'app-1'},
        id: 'attachment-id',
        name: 'DATABASE',
      },
    ])
    const list = vi.fn().mockResolvedValue([{name: 'default', state: 'created'}])

    const result = await listCredentials(buildCtx({list, resolutionByAttachment}), 'app-1', 'DATABASE_URL')

    expect(list).toHaveBeenCalledWith('addon-x')
    expect(result).toEqual([{name: 'default', state: 'created'}])
  })

  it('binds the signal to the data client so the request aborts in flight', async () => {
    const resolutionByAttachment = vi.fn().mockResolvedValue([
      {
        addon: {
          app: {id: 'app-uuid', name: 'app-1'}, id: 'addon-x', name: 'pg-attached', plan: {name: 'heroku-postgresql:essential-0'},
        },
        app: {id: 'app-uuid', name: 'app-1'},
        id: 'attachment-id',
        name: 'DATABASE',
      },
    ])
    const list = vi.fn().mockResolvedValue([])
    const ctx = buildCtx({list, resolutionByAttachment})
    const controller = new AbortController()

    await listCredentials(ctx, 'app-1', 'DATABASE_URL', {signal: controller.signal})

    expect((ctx.data as unknown as {withOptions: ReturnType<typeof vi.fn>}).withOptions)
      .toHaveBeenCalledWith({signal: controller.signal})
  })

  it('postgresDatabaseExtensions declares service: data, resource: postgresDatabase', () => {
    expect(postgresDatabaseExtensions.service).toBe('data')
    expect(postgresDatabaseExtensions.resource).toBe('postgresDatabase')
  })

  describe('deleteAttachment', () => {
    it('resolves the attachment by name and deletes it on an Advanced-tier database', async () => {
      const attachmentMock = buildAttachment({addonId: 'addon-1', addonName: 'pg-addon'})
      const addonMock = buildAddon({id: 'addon-1', planName: 'heroku-postgresql:advanced-0'})
      const infoByApp = vi.fn().mockResolvedValue(attachmentMock)
      const addonResolution = vi.fn().mockResolvedValue([addonMock])
      const deleteAttachmentMock = vi.fn().mockResolvedValue({id: 'attachment-1', name: 'DATABASE'})
      const ctx = buildCtx({addonResolution, deleteAttachment: deleteAttachmentMock, infoByApp})

      const {addon, attachment} = await deleteAttachment(ctx, 'app-1', 'DATABASE')

      expect(infoByApp).toHaveBeenCalledWith('app-1', 'DATABASE')
      expect(addonResolution).toHaveBeenCalledWith({addon: 'pg-addon'})
      expect(deleteAttachmentMock).toHaveBeenCalledWith('attachment-1')
      expect(addon).toEqual(addonMock)
      expect(attachment).toEqual({id: 'attachment-1', name: 'DATABASE'})
    })

    it('throws NotAdvancedDatabaseError with the resolved database for classic-tier databases', async () => {
      const attachmentMock = buildAttachment({addonId: 'addon-1', addonName: 'pg-addon'})
      const addonMock = buildAddon({id: 'addon-1', planName: 'heroku-postgresql:standard-0'})
      const deleteAttachmentMock = vi.fn()
      const ctx = buildCtx({
        addonResolution: vi.fn().mockResolvedValue([addonMock]),
        deleteAttachment: deleteAttachmentMock,
        infoByApp: vi.fn().mockResolvedValue(attachmentMock),
      })

      const error = await deleteAttachment(ctx, 'app-1', 'DATABASE').catch((error_: unknown) => error_)

      expect(error).toBeInstanceOf(NotAdvancedDatabaseError)
      expect((error as NotAdvancedDatabaseError).addon).toEqual(addonMock)
      expect(deleteAttachmentMock).not.toHaveBeenCalled()
    })

    it('throws if signal is aborted', async () => {
      const ctx = buildCtx()
      const controller = new AbortController()
      controller.abort()

      await expect(deleteAttachment(ctx, 'app-1', 'DATABASE', {signal: controller.signal})).rejects.toThrow()
    })

    it('runs beforeDelete with the resolved addon and attachment before deleting', async () => {
      const attachmentMock = buildAttachment({addonId: 'addon-1', addonName: 'pg-addon'})
      const addonMock = buildAddon({id: 'addon-1', planName: 'heroku-postgresql:advanced-0'})
      const calls: string[] = []
      const deleteAttachmentMock = vi.fn(async () => {
        calls.push('delete')
        return {id: 'attachment-1', name: 'DATABASE'}
      })
      const ctx = buildCtx({
        addonResolution: vi.fn().mockResolvedValue([addonMock]),
        deleteAttachment: deleteAttachmentMock,
        infoByApp: vi.fn().mockResolvedValue(attachmentMock),
      })
      const beforeDelete = vi.fn(() => {
        calls.push('beforeDelete')
      })

      await deleteAttachment(ctx, 'app-1', 'DATABASE', {beforeDelete})

      expect(beforeDelete).toHaveBeenCalledWith({addon: addonMock, attachment: attachmentMock})
      expect(calls).toEqual(['beforeDelete', 'delete'])
    })

    it('does not delete if beforeDelete rejects', async () => {
      const attachmentMock = buildAttachment({addonId: 'addon-1', addonName: 'pg-addon'})
      const addonMock = buildAddon({id: 'addon-1', planName: 'heroku-postgresql:advanced-0'})
      const deleteAttachmentMock = vi.fn()
      const ctx = buildCtx({
        addonResolution: vi.fn().mockResolvedValue([addonMock]),
        deleteAttachment: deleteAttachmentMock,
        infoByApp: vi.fn().mockResolvedValue(attachmentMock),
      })
      const beforeDelete = vi.fn().mockRejectedValue(new Error('user declined'))

      await expect(deleteAttachment(ctx, 'app-1', 'DATABASE', {beforeDelete})).rejects.toThrow('user declined')
      expect(deleteAttachmentMock).not.toHaveBeenCalled()
    })

    it('does not delete if the signal aborts inside beforeDelete', async () => {
      const attachmentMock = buildAttachment({addonId: 'addon-1', addonName: 'pg-addon'})
      const addonMock = buildAddon({id: 'addon-1', planName: 'heroku-postgresql:advanced-0'})
      const deleteAttachmentMock = vi.fn()
      const ctx = buildCtx({
        addonResolution: vi.fn().mockResolvedValue([addonMock]),
        deleteAttachment: deleteAttachmentMock,
        infoByApp: vi.fn().mockResolvedValue(attachmentMock),
      })
      const controller = new AbortController()
      const beforeDelete = vi.fn(() => controller.abort())

      await expect(deleteAttachment(ctx, 'app-1', 'DATABASE', {beforeDelete, signal: controller.signal})).rejects.toThrow()
      expect(deleteAttachmentMock).not.toHaveBeenCalled()
    })
  })

  describe('createAttachment', () => {
    it('resolves the source database scoped to the target app, creates the attachment, and reports the latest release', async () => {
      const addonMock = buildAddon({id: 'addon-1', planName: 'heroku-postgresql:advanced-0'})
      const addonResolution = vi.fn().mockResolvedValue([addonMock])
      const createAttachmentMock = vi.fn().mockResolvedValue({id: 'attachment-1', name: 'DATABASE'})
      const releaseList = vi.fn().mockResolvedValue([{version: 42}])
      const ctx = buildCtx({addonResolution, createAttachment: createAttachmentMock, releaseList})

      const {addon, attachment, releaseVersion} = await createAttachment(ctx, 'target-app', 'pg-addon', {
        confirm: 'target-app',
        name: 'DATABASE',
        // eslint-disable-next-line camelcase
        namespace_config: {pool: 'default'},
      })

      expect(addonResolution).toHaveBeenCalledWith({addon: 'pg-addon', app: 'target-app'})
      expect(createAttachmentMock).toHaveBeenCalledWith({
        addon: 'pg-addon',
        app: 'target-app',
        confirm: 'target-app',
        name: 'DATABASE',
        // eslint-disable-next-line camelcase
        namespace_config: {pool: 'default'},
      })
      expect(addon).toEqual(addonMock)
      expect(attachment).toEqual({id: 'attachment-1', name: 'DATABASE'})
      expect(releaseVersion).toBe(42)
    })

    it('retries unscoped when the scoped-to-app resolve finds no match', async () => {
      const addonMock = buildAddon({id: 'addon-1', planName: 'heroku-postgresql:advanced-0'})
      const addonResolution = vi.fn()
        .mockRejectedValueOnce(new AddonNotFoundError())
        .mockResolvedValueOnce([addonMock])
      const createAttachmentMock = vi.fn().mockResolvedValue({id: 'attachment-1', name: 'DATABASE'})
      const releaseList = vi.fn().mockResolvedValue([{version: 1}])
      const ctx = buildCtx({addonResolution, createAttachment: createAttachmentMock, releaseList})

      const {addon} = await createAttachment(ctx, 'target-app', 'other-app-addon')

      expect(addonResolution).toHaveBeenNthCalledWith(1, {addon: 'other-app-addon', app: 'target-app'})
      expect(addonResolution).toHaveBeenNthCalledWith(2, {addon: 'other-app-addon'})
      expect(addon).toEqual(addonMock)
    })

    it('throws NotAdvancedDatabaseError for classic-tier databases without creating the attachment', async () => {
      const addonMock = buildAddon({id: 'addon-1', planName: 'heroku-postgresql:standard-0'})
      const addonResolution = vi.fn().mockResolvedValue([addonMock])
      const createAttachmentMock = vi.fn()
      const ctx = buildCtx({addonResolution, createAttachment: createAttachmentMock})

      const error = await createAttachment(ctx, 'target-app', 'pg-addon').catch((error_: unknown) => error_)

      expect(error).toBeInstanceOf(NotAdvancedDatabaseError)
      expect((error as NotAdvancedDatabaseError).addon).toEqual(addonMock)
      expect(createAttachmentMock).not.toHaveBeenCalled()
    })

    it('converts a 423 confirmation_required platform error into AddonConfirmationRequiredError', async () => {
      const addonMock = buildAddon({id: 'addon-1', planName: 'heroku-postgresql:advanced-0'})
      const addonResolution = vi.fn().mockResolvedValue([addonMock])
      const createAttachmentMock = vi.fn().mockRejectedValue(new HerokuApiError('confirmation required', 423, new Response(null, {status: 423}), {
        id: 'confirmation_required',
        message: 'Please confirm by typing the application name.',
      }))
      const ctx = buildCtx({addonResolution, createAttachment: createAttachmentMock})

      const error = await createAttachment(ctx, 'target-app', 'pg-addon').catch((error_: unknown) => error_)

      expect(error).toBeInstanceOf(AddonConfirmationRequiredError)
      expect((error as AddonConfirmationRequiredError).platformMessage).toBe('Please confirm by typing the application name.')
    })

    it('throws if signal is aborted', async () => {
      const ctx = buildCtx()
      const controller = new AbortController()
      controller.abort()

      await expect(createAttachment(ctx, 'target-app', 'pg-addon', {}, {signal: controller.signal})).rejects.toThrow()
    })

    it('runs onAttached with the created attachment before fetching the release', async () => {
      const addonMock = buildAddon({id: 'addon-1', planName: 'heroku-postgresql:advanced-0'})
      const addonResolution = vi.fn().mockResolvedValue([addonMock])
      const createAttachmentMock = vi.fn().mockResolvedValue({id: 'attachment-1', name: 'DATABASE'})
      const calls: string[] = []
      const releaseList = vi.fn(async () => {
        calls.push('releaseList')
        return [{version: 7}]
      })
      const ctx = buildCtx({addonResolution, createAttachment: createAttachmentMock, releaseList})
      const onAttached = vi.fn((attachment: {name: string}) => {
        calls.push(`onAttached:${attachment.name}`)
      })

      await createAttachment(ctx, 'target-app', 'pg-addon', {}, {onAttached})

      expect(onAttached).toHaveBeenCalledWith({id: 'attachment-1', name: 'DATABASE'})
      expect(calls).toEqual(['onAttached:DATABASE', 'releaseList'])
    })
  })
})
