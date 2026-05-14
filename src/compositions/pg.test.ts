import type {AddOnAttachment} from '@heroku/types/3.sdk'

import {
  afterEach, describe, expect, it, vi,
} from 'vitest'

import {createDataClient} from '../services/data.js'
import {createPlatformClient} from '../services/platform.js'
import {
  backups, credentials, info, maintenance, upgradePrepare, upgradeRun,
} from './pg.js'

vi.mock('../services/platform.js', () => ({
  createPlatformClient: vi.fn(),
}))

vi.mock('../services/data.js', () => ({
  createDataClient: vi.fn(),
}))

function attachmentMatch(addonId: string): AddOnAttachment[] {
  return [{addon: {app: {name: 'app-1'}, id: addonId, name: 'postgresql-addon'}}]
}

describe('pg compositions', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('info', () => {
    it('resolves the addon via the platform client and calls database.info', async () => {
      const resolution = vi.fn().mockResolvedValue(attachmentMatch('addon-1'))
      const dbInfo = vi.fn().mockResolvedValue({plan: 'standard-0', uuid: 'addon-1'})
      vi.mocked(createPlatformClient).mockReturnValue({addOnAttachment: {resolution}} as never)
      vi.mocked(createDataClient).mockReturnValue({database: {info: dbInfo}} as never)

      const result = await info('app-1', 'HEROKU_POSTGRESQL_BLUE')

      // eslint-disable-next-line camelcase
      expect(resolution).toHaveBeenCalledWith({addon_attachment: 'HEROKU_POSTGRESQL_BLUE', app: 'app-1'})
      expect(dbInfo).toHaveBeenCalledWith('addon-1')
      expect(result).toEqual({plan: 'standard-0', uuid: 'addon-1'})
    })

    it('defaults the addon identifier to DATABASE_URL when omitted', async () => {
      const resolution = vi.fn().mockResolvedValue(attachmentMatch('addon-2'))
      const dbInfo = vi.fn().mockResolvedValue({})
      vi.mocked(createPlatformClient).mockReturnValue({addOnAttachment: {resolution}} as never)
      vi.mocked(createDataClient).mockReturnValue({database: {info: dbInfo}} as never)

      await info('app-1')

      // eslint-disable-next-line camelcase
      expect(resolution).toHaveBeenCalledWith({addon_attachment: 'DATABASE_URL', app: 'app-1'})
    })

    it('throws when resolution returns no addon id', async () => {
      const resolution = vi.fn().mockResolvedValue([])
      vi.mocked(createPlatformClient).mockReturnValue({addOnAttachment: {resolution}} as never)
      vi.mocked(createDataClient).mockReturnValue({database: {info: vi.fn()}} as never)

      await expect(info('app-1', 'NOPE')).rejects.toThrow(/Could not resolve add-on/)
    })

    it('throws if the abort signal is already aborted', async () => {
      const controller = new AbortController()
      controller.abort()

      await expect(info('app-1', undefined, {signal: controller.signal})).rejects.toThrow()
      expect(createPlatformClient).not.toHaveBeenCalled()
    })

    it('forwards clientOptions to both clients', async () => {
      const resolution = vi.fn().mockResolvedValue(attachmentMatch('addon-3'))
      const dbInfo = vi.fn().mockResolvedValue({})
      vi.mocked(createPlatformClient).mockReturnValue({addOnAttachment: {resolution}} as never)
      vi.mocked(createDataClient).mockReturnValue({database: {info: dbInfo}} as never)

      await info('app-1', undefined, {clientOptions: {token: 'abc'}})

      expect(createPlatformClient).toHaveBeenCalledWith({token: 'abc'})
      expect(createDataClient).toHaveBeenCalledWith({token: 'abc'})
    })
  })

  describe('credentials', () => {
    it('calls postgresDatabase.listCredentials with the resolved addon id', async () => {
      const resolution = vi.fn().mockResolvedValue(attachmentMatch('addon-4'))
      const list = vi.fn().mockResolvedValue([{name: 'default', state: 'created'}])
      vi.mocked(createPlatformClient).mockReturnValue({addOnAttachment: {resolution}} as never)
      vi.mocked(createDataClient).mockReturnValue({postgresDatabase: {listCredentials: list}} as never)

      const result = await credentials('app-1')

      expect(list).toHaveBeenCalledWith('addon-4')
      expect(result).toEqual([{name: 'default', state: 'created'}])
    })
  })

  describe('maintenance', () => {
    it('calls maintenance.info with the resolved addon id', async () => {
      const resolution = vi.fn().mockResolvedValue(attachmentMatch('addon-5'))
      const maintenanceInfo = vi.fn().mockResolvedValue({state: 'scheduled'})
      vi.mocked(createPlatformClient).mockReturnValue({addOnAttachment: {resolution}} as never)
      vi.mocked(createDataClient).mockReturnValue({maintenance: {info: maintenanceInfo}} as never)

      const result = await maintenance('app-1', 'DATABASE_URL')

      expect(maintenanceInfo).toHaveBeenCalledWith('addon-5')
      expect(result).toEqual({state: 'scheduled'})
    })
  })

  describe('backups', () => {
    it('calls transfer.listByApp with the app identity (no addon resolution)', async () => {
      // eslint-disable-next-line camelcase
      const listByApp = vi.fn().mockResolvedValue([{from_type: 'pg_dump', uuid: 'xfer-1'}])
      vi.mocked(createDataClient).mockReturnValue({transfer: {listByApp}} as never)

      const result = await backups('app-1')

      expect(listByApp).toHaveBeenCalledWith('app-1')
      expect(createPlatformClient).not.toHaveBeenCalled()
      // eslint-disable-next-line camelcase
      expect(result).toEqual([{from_type: 'pg_dump', uuid: 'xfer-1'}])
    })

    it('throws if the abort signal is already aborted', async () => {
      const controller = new AbortController()
      controller.abort()

      await expect(backups('app-1', {signal: controller.signal})).rejects.toThrow()
      expect(createDataClient).not.toHaveBeenCalled()
    })
  })

  describe('upgradeRun', () => {
    it('calls database.runUpgrade with the resolved addon id and body', async () => {
      const resolution = vi.fn().mockResolvedValue(attachmentMatch('addon-6'))
      const runUpgrade = vi.fn().mockResolvedValue({message: 'upgrading'})
      vi.mocked(createPlatformClient).mockReturnValue({addOnAttachment: {resolution}} as never)
      vi.mocked(createDataClient).mockReturnValue({database: {runUpgrade}} as never)

      const result = await upgradeRun('app-1', 'DATABASE_URL', {version: '17'})

      expect(runUpgrade).toHaveBeenCalledWith('addon-6', {version: '17'})
      expect(result).toEqual({message: 'upgrading'})
    })

    it('defaults to an empty body when none is provided', async () => {
      const resolution = vi.fn().mockResolvedValue(attachmentMatch('addon-7'))
      const runUpgrade = vi.fn().mockResolvedValue({})
      vi.mocked(createPlatformClient).mockReturnValue({addOnAttachment: {resolution}} as never)
      vi.mocked(createDataClient).mockReturnValue({database: {runUpgrade}} as never)

      await upgradeRun('app-1')

      expect(runUpgrade).toHaveBeenCalledWith('addon-7', {})
    })
  })

  describe('upgradePrepare', () => {
    it('calls database.prepareUpgrade with the resolved addon id and body', async () => {
      const resolution = vi.fn().mockResolvedValue(attachmentMatch('addon-8'))
      const prepareUpgrade = vi.fn().mockResolvedValue({message: 'scheduled'})
      vi.mocked(createPlatformClient).mockReturnValue({addOnAttachment: {resolution}} as never)
      vi.mocked(createDataClient).mockReturnValue({database: {prepareUpgrade}} as never)

      const result = await upgradePrepare('app-1', 'DATABASE_URL', {version: '17'})

      expect(prepareUpgrade).toHaveBeenCalledWith('addon-8', {version: '17'})
      expect(result).toEqual({message: 'scheduled'})
    })
  })
})
