import {HerokuApiError, NotFoundError} from '@heroku/heroku-fetch'
import {
  describe, expect, it, vi,
} from 'vitest'

import type {ResourceCtx} from '../../core/extend-resource.js'

import {
  AddonAppMismatchError, AddonConfirmationRequiredError, AddonDestroyFailedError, AddonNotFoundError,
} from '../platform/add-on/errors.js'
import {getPostgresServiceName, NotAdvancedDatabaseError} from './internal/postgres-utils.js'
import {
  createAttachment, deleteAttachment, destroy, listAttachments, listCredentials, postgresDatabaseExtensions,
} from './postgres-database.js'

function buildCtx(opts: {
  addOnDelete?: ReturnType<typeof vi.fn>
  addOnInfoByApp?: ReturnType<typeof vi.fn>
  addonResolution?: ReturnType<typeof vi.fn>
  createAttachment?: ReturnType<typeof vi.fn>
  credentialList?: ReturnType<typeof vi.fn>
  deleteAttachment?: ReturnType<typeof vi.fn>
  infoByApp?: ReturnType<typeof vi.fn>
  list?: ReturnType<typeof vi.fn>
  listByAddOn?: ReturnType<typeof vi.fn>
  releaseList?: ReturnType<typeof vi.fn>
  resolutionByAttachment?: ReturnType<typeof vi.fn>
} = {}): Pick<ResourceCtx, 'data' | 'platform'> {
  const data: Record<string, unknown> = {
    postgresCredential: {list: opts.credentialList ?? vi.fn().mockResolvedValue({items: []})},
    postgresDatabase: {listCredentials: opts.list ?? vi.fn()},
  }
  // Self-referential so a `.withOptions({signal})` chain resolves back to data.
  data.withOptions = vi.fn(() => data)

  return {
    data: data as never,
    platform: {
      addOn: {
        delete: opts.addOnDelete ?? vi.fn(),
        infoByApp: opts.addOnInfoByApp ?? vi.fn(),
        resolution: opts.addonResolution ?? vi.fn(),
      },
      addOnAttachment: {
        create: opts.createAttachment ?? vi.fn(),
        delete: opts.deleteAttachment ?? vi.fn(),
        infoByApp: opts.infoByApp ?? vi.fn(),
        listByAddOn: opts.listByAddOn ?? vi.fn().mockResolvedValue([]),
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

      const {
        addon, attachment, releaseVersion,
      } = await deleteAttachment(ctx, 'app-1', 'DATABASE')

      expect(infoByApp).toHaveBeenCalledWith('app-1', 'DATABASE')
      expect(addonResolution).toHaveBeenCalledWith({addon: 'pg-addon'})
      expect(deleteAttachmentMock).toHaveBeenCalledWith('attachment-1')
      expect(addon).toEqual(addonMock)
      expect(attachment).toEqual({id: 'attachment-1', name: 'DATABASE'})
      expect(releaseVersion).toBe(1)
    })

    it('runs onDetached with the deleted attachment before fetching the release', async () => {
      const attachmentMock = buildAttachment({addonId: 'addon-1', addonName: 'pg-addon'})
      const addonMock = buildAddon({id: 'addon-1', planName: 'heroku-postgresql:advanced-0'})
      const calls: string[] = []
      const deleteAttachmentMock = vi.fn(async () => {
        calls.push('delete')
        return {id: 'attachment-1', name: 'DATABASE'}
      })
      const releaseList = vi.fn(async () => {
        calls.push('releaseList')
        return [{version: 9}]
      })
      const ctx = buildCtx({
        addonResolution: vi.fn().mockResolvedValue([addonMock]),
        deleteAttachment: deleteAttachmentMock,
        infoByApp: vi.fn().mockResolvedValue(attachmentMock),
        releaseList,
      })
      const onDetached = vi.fn((attachment: {name: string}) => {
        calls.push(`onDetached:${attachment.name}`)
      })

      const {releaseVersion} = await deleteAttachment(ctx, 'app-1', 'DATABASE', {onDetached})

      expect(onDetached).toHaveBeenCalledWith({id: 'attachment-1', name: 'DATABASE'})
      expect(calls).toEqual(['delete', 'onDetached:DATABASE', 'releaseList'])
      expect(releaseVersion).toBe(9)
    })

    it('reports an undefined release version when the release lookup fails after detaching', async () => {
      const attachmentMock = buildAttachment({addonId: 'addon-1', addonName: 'pg-addon'})
      const addonMock = buildAddon({id: 'addon-1', planName: 'heroku-postgresql:advanced-0'})
      const deleteAttachmentMock = vi.fn().mockResolvedValue({id: 'attachment-1', name: 'DATABASE'})
      const releaseList = vi.fn().mockRejectedValue(new Error('releases unavailable'))
      const ctx = buildCtx({
        addonResolution: vi.fn().mockResolvedValue([addonMock]),
        deleteAttachment: deleteAttachmentMock,
        infoByApp: vi.fn().mockResolvedValue(attachmentMock),
        releaseList,
      })

      const {attachment, releaseVersion} = await deleteAttachment(ctx, 'app-1', 'DATABASE')

      expect(deleteAttachmentMock).toHaveBeenCalledWith('attachment-1')
      expect(attachment).toEqual({id: 'attachment-1', name: 'DATABASE'})
      expect(releaseVersion).toBeUndefined()
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

  describe('listAttachments', () => {
    it('resolves the database scoped to the app and fans out credentials + attachments', async () => {
      const addonMock = buildAddon({id: 'addon-1', planName: 'heroku-postgresql:advanced-0'})
      const addonResolution = vi.fn().mockResolvedValue([addonMock])
      const credentialList = vi.fn().mockResolvedValue({items: [{name: 'default', type: 'owner'}]})
      const listByAddOn = vi.fn().mockResolvedValue([{id: 'attachment-1', name: 'DATABASE'}])
      const ctx = buildCtx({addonResolution, credentialList, listByAddOn})

      const {addon, attachments, credentials} = await listAttachments(ctx, 'pg-addon', {appIdentity: 'app-1'})

      expect(addonResolution).toHaveBeenCalledWith({addon: 'pg-addon', app: 'app-1'})
      expect(credentialList).toHaveBeenCalledWith('addon-1')
      expect(listByAddOn).toHaveBeenCalledWith('addon-1')
      expect(addon).toEqual(addonMock)
      expect(attachments).toEqual([{id: 'attachment-1', name: 'DATABASE'}])
      expect(credentials).toEqual([{name: 'default', type: 'owner'}])
    })

    it('throws NotAdvancedDatabaseError for classic-tier databases without fanning out', async () => {
      const addonMock = buildAddon({id: 'addon-1', planName: 'heroku-postgresql:standard-0'})
      const credentialList = vi.fn()
      const listByAddOn = vi.fn()
      const ctx = buildCtx({
        addonResolution: vi.fn().mockResolvedValue([addonMock]),
        credentialList,
        listByAddOn,
      })

      const error = await listAttachments(ctx, 'pg-addon', {appIdentity: 'app-1'}).catch((error_: unknown) => error_)

      expect(error).toBeInstanceOf(NotAdvancedDatabaseError)
      expect((error as NotAdvancedDatabaseError).addon).toEqual(addonMock)
      expect(credentialList).not.toHaveBeenCalled()
      expect(listByAddOn).not.toHaveBeenCalled()
    })

    it('throws if signal is aborted', async () => {
      const ctx = buildCtx()
      const controller = new AbortController()
      controller.abort()

      await expect(listAttachments(ctx, 'pg-addon', {signal: controller.signal})).rejects.toThrow()
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
        .mockRejectedValueOnce(new NotFoundError(new Response(null, {status: 404}), {id: 'addon-not-found', message: 'addon not found'}))
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

  describe('destroy', () => {
    it('resolves the database scoped to the app and deletes it via addOn.delete', async () => {
      const addonMock = buildAddon({id: 'addon-1', planName: 'heroku-postgresql:advanced-0'})
      const addonResolution = vi.fn().mockResolvedValue([addonMock])
      const deleted = {id: 'addon-1', name: 'pg-addon', state: 'deprovisioning'}
      const addOnDelete = vi.fn().mockResolvedValue(deleted)
      const ctx = buildCtx({addOnDelete, addonResolution})

      const {addon, result} = await destroy(ctx, 'pg-addon', {appIdentity: 'app-1'})

      expect(addonResolution).toHaveBeenCalledWith({addon: 'pg-addon', app: 'app-1'})
      expect(addOnDelete).toHaveBeenCalledWith('app-uuid', 'addon-1')
      expect(addon).toEqual(addonMock)
      expect(result).toEqual(deleted)
    })

    it('destroys classic-tier databases too (no advanced-tier gate)', async () => {
      const addonMock = buildAddon({id: 'addon-1', planName: 'heroku-postgresql:standard-0'})
      const deleted = {id: 'addon-1', state: 'deprovisioning'}
      const addOnDelete = vi.fn().mockResolvedValue(deleted)
      const ctx = buildCtx({addOnDelete, addonResolution: vi.fn().mockResolvedValue([addonMock])})

      const {result} = await destroy(ctx, 'pg-addon')

      expect(addOnDelete).toHaveBeenCalledWith('app-uuid', 'addon-1')
      expect(result).toEqual(deleted)
    })

    it('runs beforeDestroy with the resolved addon before deleting', async () => {
      const addonMock = buildAddon({id: 'addon-1', planName: 'heroku-postgresql:advanced-0'})
      const calls: string[] = []
      const addOnDelete = vi.fn(async () => {
        calls.push('delete')
        return {id: 'addon-1', state: 'deprovisioned'}
      })
      const ctx = buildCtx({addOnDelete, addonResolution: vi.fn().mockResolvedValue([addonMock])})
      const beforeDestroy = vi.fn(() => {
        calls.push('beforeDestroy')
      })

      await destroy(ctx, 'pg-addon', {beforeDestroy})

      expect(beforeDestroy).toHaveBeenCalledWith({addon: addonMock})
      expect(calls).toEqual(['beforeDestroy', 'delete'])
    })

    it('does not delete if beforeDestroy rejects', async () => {
      const addonMock = buildAddon({id: 'addon-1', planName: 'heroku-postgresql:advanced-0'})
      const addOnDelete = vi.fn()
      const ctx = buildCtx({addOnDelete, addonResolution: vi.fn().mockResolvedValue([addonMock])})
      const beforeDestroy = vi.fn().mockRejectedValue(new Error('user declined'))

      await expect(destroy(ctx, 'pg-addon', {beforeDestroy})).rejects.toThrow('user declined')
      expect(addOnDelete).not.toHaveBeenCalled()
    })

    it('throws AddonAppMismatchError when the database exists under a different app', async () => {
      const elsewhere = buildAddon({id: 'addon-1', planName: 'heroku-postgresql:advanced-0'})
      const addonResolution = vi.fn()
        .mockRejectedValueOnce(new AddonNotFoundError()) // scoped to app-2 misses
        .mockResolvedValueOnce([elsewhere]) // unscoped finds it on app-1
      const addOnDelete = vi.fn()
      const ctx = buildCtx({addOnDelete, addonResolution})

      const error = await destroy(ctx, 'pg-addon', {appIdentity: 'app-2'}).catch((error_: unknown) => error_)

      expect(error).toBeInstanceOf(AddonAppMismatchError)
      expect((error as Error).message).toBe('Database pg-addon is on app-1 not app-2. Try again with the correct app.')
      expect(addonResolution).toHaveBeenNthCalledWith(1, {addon: 'pg-addon', app: 'app-2'})
      expect(addonResolution).toHaveBeenNthCalledWith(2, {addon: 'pg-addon'})
      expect(addOnDelete).not.toHaveBeenCalled()
    })

    it('rethrows not-found when the database exists under no app', async () => {
      const addonResolution = vi.fn()
        .mockRejectedValueOnce(new AddonNotFoundError())
        .mockRejectedValueOnce(new AddonNotFoundError())
      const ctx = buildCtx({addonResolution})

      const error = await destroy(ctx, 'pg-addon', {appIdentity: 'app-2'}).catch((error_: unknown) => error_)

      expect(error).toBeInstanceOf(AddonNotFoundError)
    })

    it('treats an app UUID matching the resolved app as the same app, not a mismatch', async () => {
      // `appIdentity` may be an app UUID; the unscoped retry finds the database
      // on the app whose UUID was passed, so it is NOT a mismatch — the original
      // not-found propagates rather than a spurious AddonAppMismatchError echoing
      // the raw UUID.
      const elsewhere = buildAddon({id: 'addon-1', planName: 'heroku-postgresql:advanced-0'}) // app.id === 'app-uuid'
      const addonResolution = vi.fn()
        .mockRejectedValueOnce(new AddonNotFoundError())
        .mockResolvedValueOnce([elsewhere])
      const ctx = buildCtx({addonResolution})

      const error = await destroy(ctx, 'pg-addon', {appIdentity: 'app-uuid'}).catch((error_: unknown) => error_)

      expect(error).toBeInstanceOf(AddonNotFoundError)
      expect(error).not.toBeInstanceOf(AddonAppMismatchError)
    })

    it('skips the mismatch probe for `::`-qualified identities', async () => {
      // A `::`-qualified identity names its app inline, so resolveAddonInternal
      // ignores appIdentity and the unscoped retry would repeat the same failing
      // request — the not-found propagates without a second resolve.
      const addonResolution = vi.fn().mockRejectedValueOnce(new AddonNotFoundError())
      const ctx = buildCtx({addonResolution})

      const error = await destroy(ctx, 'other-app::DATABASE', {appIdentity: 'app-2'}).catch((error_: unknown) => error_)

      expect(error).toBeInstanceOf(AddonNotFoundError)
      expect(addonResolution).toHaveBeenCalledTimes(1)
    })

    it('rethrows an abort raised during the mismatch probe instead of masking it as not-found', async () => {
      const controller = new AbortController()
      const abortDuringRetry = vi.fn()
        .mockRejectedValueOnce(new AddonNotFoundError())
        .mockImplementationOnce(() => {
          controller.abort()
          return Promise.reject(new Error('aborted retry'))
        })
      const ctx = buildCtx({addonResolution: abortDuringRetry})

      const error = await destroy(ctx, 'pg-addon', {appIdentity: 'app-2', signal: controller.signal})
        .catch((error_: unknown) => error_)

      expect((error as Error).message).toBe('aborted retry')
      expect(error).not.toBeInstanceOf(AddonNotFoundError)
    })

    it('converts a platform confirmation_required during the delete into AddonConfirmationRequiredError', async () => {
      const addonMock = buildAddon({id: 'addon-1', planName: 'heroku-postgresql:advanced-0'})
      const addOnDelete = vi.fn().mockRejectedValue(new HerokuApiError('confirmation required', 423, new Response(null, {status: 423}), {
        id: 'confirmation_required',
        message: 'Please confirm by typing the application name.',
      }))
      const ctx = buildCtx({addOnDelete, addonResolution: vi.fn().mockResolvedValue([addonMock])})

      const error = await destroy(ctx, 'pg-addon', {appIdentity: 'app-1'}).catch((error_: unknown) => error_)

      expect(error).toBeInstanceOf(AddonConfirmationRequiredError)
      expect(error).not.toBeInstanceOf(AddonDestroyFailedError)
    })

    it('wraps a delete-request failure in AddonDestroyFailedError carrying the resolved addon', async () => {
      const addonMock = buildAddon({id: 'addon-1', planName: 'heroku-postgresql:advanced-0'})
      const cause = {body: {message: 'boom'}}
      const addOnDelete = vi.fn().mockRejectedValue(cause)
      const ctx = buildCtx({addOnDelete, addonResolution: vi.fn().mockResolvedValue([addonMock])})

      const error = await destroy(ctx, 'pg-addon', {appIdentity: 'app-1'}).catch((error_: unknown) => error_)

      expect(error).toBeInstanceOf(AddonDestroyFailedError)
      expect((error as AddonDestroyFailedError).addon).toEqual(addonMock)
      expect((error as AddonDestroyFailedError).cause).toBe(cause)
      expect((error as Error).message).toBe('boom')
    })

    it('throws if signal is aborted', async () => {
      const ctx = buildCtx()
      const controller = new AbortController()
      controller.abort()

      await expect(destroy(ctx, 'pg-addon', {signal: controller.signal})).rejects.toThrow()
    })
  })
})
