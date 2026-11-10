import {
  describe, expect, it, vi,
} from 'vitest'

import type {ResourceCtx} from '../../../core/extend-resource.js'

import {
  createCredentials,
  deleteCredential,
  getUrl,
  listCredentials,
  repairDefault,
  rotateCredential,
} from './credentials.js'

function buildCtx(opts: {
  createCredentials?: ReturnType<typeof vi.fn>
  credentialList?: ReturnType<typeof vi.fn>
  deleteCredential?: ReturnType<typeof vi.fn>
  infoCredential?: ReturnType<typeof vi.fn>
  list?: ReturnType<typeof vi.fn>
  listByAddOn?: ReturnType<typeof vi.fn>
  repairDefault?: ReturnType<typeof vi.fn>
  resolutionByAttachment?: ReturnType<typeof vi.fn>
  rotateCredential?: ReturnType<typeof vi.fn>
  rotateCredentials?: ReturnType<typeof vi.fn>
} = {}): Pick<ResourceCtx, 'data' | 'platform'> {
  const data: Record<string, unknown> = {
    postgresDatabase: {
      createCredentials: opts.createCredentials ?? vi.fn(),
      deleteCredential: opts.deleteCredential ?? vi.fn(),
      infoCredential: opts.infoCredential ?? vi.fn(),
      listCredentials: opts.list ?? vi.fn(),
      repairDefault: opts.repairDefault ?? vi.fn(),
      rotateCredential: opts.rotateCredential ?? vi.fn(),
      rotateCredentials: opts.rotateCredentials ?? vi.fn(),
    },
  }

  data.withOptions = vi.fn(() => data)

  return {
    data: data as never,
    platform: {
      addOnAttachment: {
        listByAddOn: opts.listByAddOn ?? vi.fn().mockResolvedValue([]),
        resolution: opts.resolutionByAttachment ?? vi.fn(),
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

function resolvedAttachmentMock(addon: {id: string; name: string; plan: {name: string}}) {
  return vi.fn().mockResolvedValue([
    {
      addon,
      app: {id: 'app-uuid', name: 'app-1'},
      id: 'attachment-id',
      name: 'DATABASE',
    },
  ])
}

const essentialAddon = {
  app: {id: 'app-uuid', name: 'app-1'}, id: 'addon-essential', name: 'pg-essential', plan: {name: 'heroku-postgresql:essential-0'},
}
const legacyEssentialAddon = {
  app: {id: 'app-uuid', name: 'app-1'}, id: 'addon-legacy-essential', name: 'pg-legacy-essential', plan: {name: 'heroku-postgresql:mini'},
}
const standardAddon = {
  app: {id: 'app-uuid', name: 'app-1'}, id: 'addon-standard', name: 'pg-standard', plan: {name: 'heroku-postgresql:standard-0'},
}

describe('postgres-database credentials', () => {
  describe('listCredentials', () => {
    it('resolves the database and lists the credentials', async () => {
      const resolutionByAttachment = resolvedAttachmentMock(essentialAddon)
      const listCredentialsMock = vi.fn().mockResolvedValue([{name: 'default', state: 'created'}])

      const {addon, credentials} = await listCredentials(buildCtx({list: listCredentialsMock, resolutionByAttachment}), 'app-1', {addonIdentity: 'DATABASE_URL'})

      expect(listCredentialsMock).toHaveBeenCalledWith('addon-essential')
      expect(addon).toEqual(essentialAddon)
      expect(credentials).toEqual([{name: 'default', state: 'created'}])
    })

    it('throws if signal is aborted', async () => {
      const ctx = buildCtx()
      const controller = new AbortController()
      controller.abort()

      await expect(listCredentials(ctx, 'app-1', {addonIdentity: 'DATABASE_URL', signal: controller.signal}))
        .rejects.toThrow()
    })
  })

  describe('createCredentials', () => {
    it('resolves the database and creates the credential', async () => {
      const resolutionByAttachment = resolvedAttachmentMock(standardAddon)
      const createCredentialsMock = vi.fn().mockResolvedValue({message: 'created'})
      const ctx = buildCtx({createCredentials: createCredentialsMock, resolutionByAttachment})

      const {addon, result} = await createCredentials(ctx, 'app-1', {name: 'reporting'}, {addonIdentity: 'DATABASE_URL'})

      expect(createCredentialsMock).toHaveBeenCalledWith('addon-standard', {name: 'reporting'})
      expect(addon).toEqual(standardAddon)
      expect(result).toEqual({message: 'created'})
    })

    it('throws on Essential-tier databases without creating the credential', async () => {
      const resolutionByAttachment = resolvedAttachmentMock(essentialAddon)
      const createCredentialsMock = vi.fn()
      const ctx = buildCtx({createCredentials: createCredentialsMock, resolutionByAttachment})

      await expect(createCredentials(ctx, 'app-1', {name: 'reporting'}, {addonIdentity: 'DATABASE_URL'}))
        .rejects.toThrow("You can't create a custom credential on Essential-tier databases.")
      expect(createCredentialsMock).not.toHaveBeenCalled()
    })

    it('throw on legacy Essential-tier databases without creating the credential', async () => {
      const resolutionByAttachment = resolvedAttachmentMock(legacyEssentialAddon)
      const createCredentialsMock = vi.fn()
      const ctx = buildCtx({createCredentials: createCredentialsMock, resolutionByAttachment})

      await expect(createCredentials(ctx, 'app-1', {name: 'reporting'}, {addonIdentity: 'DATABASE_URL'}))
        .rejects.toThrow("You can't create a custom credential on Essential-tier databases.")
      expect(createCredentialsMock).not.toHaveBeenCalled()
    })

    it('throws if signal is aborted', async () => {
      const ctx = buildCtx()
      const controller = new AbortController()
      controller.abort()

      await expect(createCredentials(ctx, 'app-1', {name: 'reporting'}, {addonIdentity: 'DATABASE_URL', signal: controller.signal}))
        .rejects.toThrow()
    })
  })

  describe('repairDefault', () => {
    it('resolves the database and repairs the default credential', async () => {
      const resolutionByAttachment = resolvedAttachmentMock(standardAddon)
      const repairDefaultMock = vi.fn().mockResolvedValue({message: 'repaired'})
      const ctx = buildCtx({repairDefault: repairDefaultMock, resolutionByAttachment})

      const {addon, result} = await repairDefault(ctx, 'app-1', {addonIdentity: 'DATABASE_URL'})

      expect(repairDefaultMock).toHaveBeenCalledWith('addon-standard')
      expect(addon).toEqual(standardAddon)
      expect(result).toEqual({message: 'repaired'})
    })

    it('throws on Essential-tier databases without repairing', async () => {
      const resolutionByAttachment = resolvedAttachmentMock(essentialAddon)
      const repairDefaultMock = vi.fn()
      const ctx = buildCtx({repairDefault: repairDefaultMock, resolutionByAttachment})

      await expect(repairDefault(ctx, 'app-1', {addonIdentity: 'DATABASE_URL'}))
        .rejects.toThrow("You can't perform this operation on Essential-tier databases.")
      expect(repairDefaultMock).not.toHaveBeenCalled()
    })

    it('throw on legacy Essential-tier databases without repairing', async () => {
      const resolutionByAttachment = resolvedAttachmentMock(legacyEssentialAddon)
      const repairDefaultMock = vi.fn()
      const ctx = buildCtx({repairDefault: repairDefaultMock, resolutionByAttachment})

      await expect(repairDefault(ctx, 'app-1', {addonIdentity: 'DATABASE_URL'}))
        .rejects.toThrow("You can't perform this operation on Essential-tier databases.")
      expect(repairDefaultMock).not.toHaveBeenCalled()
    })

    it('throws if signal is aborted', async () => {
      const ctx = buildCtx()
      const controller = new AbortController()
      controller.abort()

      await expect(repairDefault(ctx, 'app-1', {addonIdentity: 'DATABASE_URL', signal: controller.signal})).rejects.toThrow()
    })
  })

  describe('getUrl', () => {
    it('resolves the database, fetches the named credential, and builds a connection url', async () => {
      const resolutionByAttachment = resolvedAttachmentMock(standardAddon)
      const infoCredentialMock = vi.fn().mockResolvedValue({
        credentials: [{password: 'secret', state: 'active', user: 'reporting'}],
        database: 'mydb',
        host: 'db.example.com',
        port: 5432,
      })
      const ctx = buildCtx({infoCredential: infoCredentialMock, resolutionByAttachment})

      const {addon, credentialConnectionInfo} = await getUrl(ctx, 'app-1', 'reporting', {addonIdentity: 'DATABASE_URL'})

      expect(infoCredentialMock).toHaveBeenCalledWith('addon-standard', 'reporting')
      expect(addon).toEqual(standardAddon)
      expect(credentialConnectionInfo).toEqual({
        credName: 'reporting',
        database: 'mydb',
        host: 'db.example.com',
        password: 'secret',
        port: 5432,
        url: 'postgres://reporting:secret@db.example.com:5432/mydb',
        user: 'reporting',
      })
    })

    it('throws on legacy Essential-tier databases for a non-default credential', async () => {
      const resolutionByAttachment = resolvedAttachmentMock(legacyEssentialAddon)
      const infoCredentialMock = vi.fn()
      const ctx = buildCtx({infoCredential: infoCredentialMock, resolutionByAttachment})

      await expect(getUrl(ctx, 'app-1', 'reporting', {addonIdentity: 'DATABASE_URL'}))
        .rejects.toThrow('Legacy Essential-tier databases do not support named credentials.')
      expect(infoCredentialMock).not.toHaveBeenCalled()
    })

    it('throws if there is no active credential', async () => {
      const resolutionByAttachment = resolvedAttachmentMock(standardAddon)
      const infoCredentialMock = vi.fn().mockResolvedValue({
        credentials: [{password: 'secret', state: 'rotating', user: 'reporting'}],
        database: 'mydb',
        host: 'db.example.com',
        port: 5432,
      })
      const ctx = buildCtx({infoCredential: infoCredentialMock, resolutionByAttachment})

      await expect(getUrl(ctx, 'app-1', 'reporting', {addonIdentity: 'DATABASE_URL'}))
        .rejects.toThrow('Could not find any active credentials for reporting.')
    })

    it('throws if signal is aborted', async () => {
      const ctx = buildCtx()
      const controller = new AbortController()
      controller.abort()

      await expect(getUrl(ctx, 'app-1', 'default', {addonIdentity: 'DATABASE_URL', signal: controller.signal})).rejects.toThrow()
    })
  })

  describe('deleteCredential', () => {
    it('resolves the database and deletes the named credential', async () => {
      const resolutionByAttachment = resolvedAttachmentMock(standardAddon)
      const deleteCredentialMock = vi.fn().mockResolvedValue({message: 'deleted'})
      const listByAddOn = vi.fn().mockResolvedValue([])
      const ctx = buildCtx({deleteCredential: deleteCredentialMock, listByAddOn, resolutionByAttachment})

      const {addon, result} = await deleteCredential(ctx, 'app-1', 'reporting', {addonIdentity: 'DATABASE_URL'})

      expect(listByAddOn).toHaveBeenCalledWith('addon-standard')
      expect(deleteCredentialMock).toHaveBeenCalledWith('addon-standard', 'reporting')
      expect(addon).toEqual(standardAddon)
      expect(result).toEqual({message: 'deleted'})
    })

    it('throws when trying to delete the default credential', async () => {
      const resolutionByAttachment = resolvedAttachmentMock(standardAddon)
      const deleteCredentialMock = vi.fn()
      const ctx = buildCtx({deleteCredential: deleteCredentialMock, resolutionByAttachment})

      await expect(deleteCredential(ctx, 'app-1', 'default', {addonIdentity: 'DATABASE_URL'}))
        .rejects.toThrow('Default credential cannot be destroyed.')
      expect(deleteCredentialMock).not.toHaveBeenCalled()
    })

    it('throws on Essential-tier databases without deleting', async () => {
      const resolutionByAttachment = resolvedAttachmentMock(essentialAddon)
      const deleteCredentialMock = vi.fn()
      const ctx = buildCtx({deleteCredential: deleteCredentialMock, resolutionByAttachment})

      await expect(deleteCredential(ctx, 'app-1', 'reporting', {addonIdentity: 'DATABASE_URL'}))
        .rejects.toThrow("You can't destroy the default credential on Essential-tier databases.")
      expect(deleteCredentialMock).not.toHaveBeenCalled()
    })

    it('throws without deleting if an app still has the credential attached', async () => {
      const resolutionByAttachment = resolvedAttachmentMock(standardAddon)
      const deleteCredentialMock = vi.fn()
      const listByAddOn = vi.fn().mockResolvedValue([
        {
          app: {id: 'other-app-uuid', name: 'other-app'}, id: 'attachment-1', name: 'DATABASE', namespace: 'credential:reporting',
        },
      ])
      const ctx = buildCtx({deleteCredential: deleteCredentialMock, listByAddOn, resolutionByAttachment})

      await expect(deleteCredential(ctx, 'app-1', 'reporting', {addonIdentity: 'DATABASE_URL'}))
        .rejects.toThrow('Credential reporting must be detached from the app other-app before destroying.')
      expect(deleteCredentialMock).not.toHaveBeenCalled()
    })

    it('throws without deleting if multiple apps still have the credential attached', async () => {
      const resolutionByAttachment = resolvedAttachmentMock(standardAddon)
      const deleteCredentialMock = vi.fn()
      const listByAddOn = vi.fn().mockResolvedValue([
        {
          app: {id: 'other-app-uuid', name: 'other-app'}, id: 'attachment-1', name: 'DATABASE', namespace: 'credential:reporting',
        },
        {
          app: {id: 'other-app-2-uuid', name: 'other-app-2'}, id: 'attachment-2', name: 'DATABASE', namespace: 'credential:reporting',
        },
      ])
      const ctx = buildCtx({deleteCredential: deleteCredentialMock, listByAddOn, resolutionByAttachment})

      await expect(deleteCredential(ctx, 'app-1', 'reporting', {addonIdentity: 'DATABASE_URL'}))
        .rejects.toThrow('Credential reporting must be detached from the apps other-app, other-app-2 before destroying.')
      expect(deleteCredentialMock).not.toHaveBeenCalled()
    })

    it('ignores attachments scoped to a different credential', async () => {
      const resolutionByAttachment = resolvedAttachmentMock(standardAddon)
      const deleteCredentialMock = vi.fn().mockResolvedValue({message: 'deleted'})
      const listByAddOn = vi.fn().mockResolvedValue([
        {
          app: {id: 'other-app-uuid', name: 'other-app'}, id: 'attachment-1', name: 'DATABASE', namespace: 'credential:default',
        },
      ])
      const ctx = buildCtx({deleteCredential: deleteCredentialMock, listByAddOn, resolutionByAttachment})

      const {result} = await deleteCredential(ctx, 'app-1', 'reporting', {addonIdentity: 'DATABASE_URL'})

      expect(deleteCredentialMock).toHaveBeenCalledWith('addon-standard', 'reporting')
      expect(result).toEqual({message: 'deleted'})
    })

    it('throws if signal is aborted', async () => {
      const ctx = buildCtx()
      const controller = new AbortController()
      controller.abort()

      await expect(deleteCredential(ctx, 'app-1', 'reporting', {addonIdentity: 'DATABASE_URL', signal: controller.signal})).rejects.toThrow()
    })
  })

  describe('rotateCredential', () => {
    it('resolves the database and rotates the default credential when no credName is given', async () => {
      const resolutionByAttachment = resolvedAttachmentMock(standardAddon)
      const rotateCredentialMock = vi.fn().mockResolvedValue({message: 'rotated'})
      const listByAddOn = vi.fn().mockResolvedValue([])
      const ctx = buildCtx({listByAddOn, resolutionByAttachment, rotateCredential: rotateCredentialMock})

      const {addon, result} = await rotateCredential(ctx, 'app-1', {forced: true}, {addonIdentity: 'DATABASE_URL'})

      expect(listByAddOn).not.toHaveBeenCalled()
      expect(rotateCredentialMock).toHaveBeenCalledWith('addon-standard', 'default', {forced: true})
      expect(addon).toEqual(standardAddon)
      expect(result).toEqual({message: 'rotated'})
    })

    it('resolves the database and rotates a named credential when credName is given', async () => {
      const resolutionByAttachment = resolvedAttachmentMock(standardAddon)
      const rotateCredentialMock = vi.fn().mockResolvedValue({message: 'rotated'})
      const ctx = buildCtx({resolutionByAttachment, rotateCredential: rotateCredentialMock})

      const {result} = await rotateCredential(ctx, 'app-1', {credName: 'reporting', forced: true}, {addonIdentity: 'DATABASE_URL'})

      expect(rotateCredentialMock).toHaveBeenCalledWith('addon-standard', 'reporting', {forced: true})
      expect(result).toEqual({message: 'rotated'})
    })

    it('rotates all credentials when `all` is true', async () => {
      const resolutionByAttachment = resolvedAttachmentMock(standardAddon)
      const rotateCredentialsMock = vi.fn().mockResolvedValue({message: 'credentials rotated'})
      const rotateCredentialMock = vi.fn().mockResolvedValue({message: 'credential rotated'})
      const listByAddOn = vi.fn().mockResolvedValue([])
      const ctx = buildCtx({
        listByAddOn, resolutionByAttachment, rotateCredential: rotateCredentialMock, rotateCredentials: rotateCredentialsMock,
      })

      const {addon, result} = await rotateCredential(ctx, 'app-1', {all: true, forced: true}, {addonIdentity: 'DATABASE_URL'})

      expect(listByAddOn).not.toHaveBeenCalled()
      expect(rotateCredentialsMock).toHaveBeenCalledWith('addon-standard', {forced: true})
      expect(rotateCredentialMock).not.toHaveBeenCalled()
      expect(addon).toEqual(standardAddon)
      expect(result).toEqual({message: 'credentials rotated'})
    })

    it('runs beforeRotate with the resolved addon before rotating a single credential', async () => {
      const resolutionByAttachment = resolvedAttachmentMock(standardAddon)
      const calls: string[] = []
      const rotateCredentialMock = vi.fn(async () => {
        calls.push('rotate')
        return {message: 'rotated'}
      })
      const listByAddOn = vi.fn()
      const ctx = buildCtx({listByAddOn, resolutionByAttachment, rotateCredential: rotateCredentialMock})
      const beforeRotate = vi.fn(() => {
        calls.push('beforeRotate')
      })

      await rotateCredential(ctx, 'app-1', {credName: 'reporting'}, {addonIdentity: 'DATABASE_URL', beforeRotate})

      expect(listByAddOn).not.toHaveBeenCalled()
      expect(beforeRotate).toHaveBeenCalledWith({addon: standardAddon})
      expect(calls).toEqual(['beforeRotate', 'rotate'])
    })

    it('runs beforeRotate with the resolved addon before rotating all credentials', async () => {
      const resolutionByAttachment = resolvedAttachmentMock(standardAddon)
      const calls: string[] = []
      const rotateCredentialsMock = vi.fn(async () => {
        calls.push('rotate')
        return {message: 'rotated'}
      })
      const listByAddOn = vi.fn()
      const ctx = buildCtx({listByAddOn, resolutionByAttachment, rotateCredentials: rotateCredentialsMock})
      const beforeRotate = vi.fn(() => {
        calls.push('beforeRotate')
      })

      await rotateCredential(ctx, 'app-1', {all: true}, {addonIdentity: 'DATABASE_URL', beforeRotate})

      expect(listByAddOn).not.toHaveBeenCalled()
      expect(beforeRotate).toHaveBeenCalledWith({addon: standardAddon})
      expect(calls).toEqual(['beforeRotate', 'rotate'])
    })

    it('does not rotate if beforeRotate rejects', async () => {
      const resolutionByAttachment = resolvedAttachmentMock(standardAddon)
      const rotateCredentialMock = vi.fn()
      const ctx = buildCtx({resolutionByAttachment, rotateCredential: rotateCredentialMock})
      const beforeRotate = vi.fn().mockRejectedValue(new Error('user declined'))

      await expect(rotateCredential(ctx, 'app-1', {credName: 'reporting'}, {addonIdentity: 'DATABASE_URL', beforeRotate}))
        .rejects.toThrow('user declined')
      expect(rotateCredentialMock).not.toHaveBeenCalled()
    })

    it('throws on legacy Essential-tier databases for a non-default credential', async () => {
      const resolutionByAttachment = resolvedAttachmentMock(legacyEssentialAddon)
      const rotateCredentialMock = vi.fn()
      const ctx = buildCtx({resolutionByAttachment, rotateCredential: rotateCredentialMock})

      await expect(rotateCredential(ctx, 'app-1', {credName: 'reporting'}, {addonIdentity: 'DATABASE_URL'}))
        .rejects.toThrow('Legacy Essential-tier databases do not support named credentials.')
      expect(rotateCredentialMock).not.toHaveBeenCalled()
    })

    it('throws if both all and credName are set, without resolving the database', async () => {
      const resolutionByAttachment = resolvedAttachmentMock(standardAddon)
      const rotateCredentialsMock = vi.fn()
      const ctx = buildCtx({resolutionByAttachment, rotateCredentials: rotateCredentialsMock})

      await expect(rotateCredential(ctx, 'app-1', {all: true, credName: 'reporting'}, {addonIdentity: 'DATABASE_URL'}))
        .rejects.toThrow('You cannot pass both `all` and `credName`')
      expect(resolutionByAttachment).not.toHaveBeenCalled()
      expect(rotateCredentialsMock).not.toHaveBeenCalled()
    })

    it('throws if signal is aborted', async () => {
      const ctx = buildCtx()
      const controller = new AbortController()
      controller.abort()

      await expect(rotateCredential(ctx, 'app-1', {credName: 'default'}, {addonIdentity: 'DATABASE_URL', signal: controller.signal})).rejects.toThrow()
    })
  })
})
