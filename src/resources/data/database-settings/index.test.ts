import {
  describe, expect, it, vi,
} from 'vitest'

import type {ResourceCtx} from '../../../core/extend-resource.js'

import {HerokuSDK} from '../../../index.js'
import {EssentialDatabaseNotSupportedError} from '../internal/postgres-utils.js'
import {PgDatabaseNotFoundError} from '../internal/resolve-pg-database.js'
import {
  databaseSettingsExtensions, get, getAll, UnknownSettingError, update,
} from './index.js'

type Mock = ReturnType<typeof vi.fn>

function pgAttachment(plan = 'heroku-postgresql:standard-0') {
  return {
    addon: {
      app: {id: 'app-1-uuid', name: 'app-1'}, id: 'addon-1', name: 'postgresql-db-1', plan: {name: plan},
    },
    app: {id: 'app-1-uuid', name: 'app-1'},
    // eslint-disable-next-line camelcase
    config_vars: ['DATABASE_URL'],
    id: 'att-1',
    name: 'DATABASE',
  }
}

const SETTINGS = {
  // eslint-disable-next-line camelcase
  log_lock_waits: {default: false, desc: 'Log lock waits.', value: true},
  // eslint-disable-next-line camelcase
  log_statement: {
    default: 'none', desc: 'Statements to log.', value: 'ddl', values: {ddl: 'DDL statements are logged.', none: 'Nothing is logged.'},
  },
}

function buildCtx(opts: {attachmentResolution?: Mock; config?: Mock; updateConfig?: Mock} = {}) {
  const attachmentResolution = opts.attachmentResolution ?? vi.fn().mockResolvedValue([pgAttachment()])
  const platform: Record<string, unknown> = {
    addOnAttachment: {listByApp: vi.fn().mockResolvedValue([]), resolution: attachmentResolution},
  }
  platform.withHeaders = vi.fn(() => platform)
  platform.withOptions = vi.fn(() => platform)

  const config = opts.config ?? vi.fn().mockResolvedValue(SETTINGS)
  const updateConfig = opts.updateConfig ?? vi.fn().mockResolvedValue(SETTINGS)
  const data: Record<string, unknown> = {postgresDatabase: {config, updateConfig}}
  data.withOptions = vi.fn(() => data)

  return {
    attachmentResolution,
    config,
    ctx: {data, platform} as unknown as Pick<ResourceCtx, 'data' | 'platform'>,
    data: data as {withOptions: Mock},
    updateConfig,
  }
}

describe('databaseSettings resource', () => {
  describe('getAll', () => {
    it('resolves DATABASE_URL by default and returns every setting with the add-on', async () => {
      const {attachmentResolution, config, ctx} = buildCtx()

      const result = await getAll(ctx, 'app-1')

      expect(attachmentResolution).toHaveBeenCalledWith(expect.objectContaining({
        // eslint-disable-next-line camelcase
        addon_attachment: 'DATABASE_URL', app: 'app-1',
      }))
      expect(config).toHaveBeenCalledWith('addon-1')
      expect(result).toEqual({addon: pgAttachment().addon, settings: SETTINGS})
    })

    it('resolves the given database identity', async () => {
      const {attachmentResolution, ctx} = buildCtx()

      await getAll(ctx, 'app-1', 'HEROKU_POSTGRESQL_RED')

      expect(attachmentResolution).toHaveBeenCalledWith(expect.objectContaining({
        // eslint-disable-next-line camelcase
        addon_attachment: 'HEROKU_POSTGRESQL_RED', app: 'app-1',
      }))
    })

    it.each([
      'heroku-postgresql:essential-0',
      'heroku-postgresql:mini',
      'heroku-postgresql:basic',
    ])('rejects %s with EssentialDatabaseNotSupportedError before fetching settings', async plan => {
      const {config, ctx} = buildCtx({attachmentResolution: vi.fn().mockResolvedValue([pgAttachment(plan)])})

      const error = await getAll(ctx, 'app-1').catch(error_ => error_)

      expect(error).toBeInstanceOf(EssentialDatabaseNotSupportedError)
      expect(error.message).toBe('Database settings aren\'t supported on Essential-tier databases. postgresql-db-1 is an Essential-tier database.')
      expect(error.addon.name).toBe('postgresql-db-1')
      expect(config).not.toHaveBeenCalled()
    })

    it('surfaces PgDatabaseNotFoundError when the app has no databases', async () => {
      const {ctx} = buildCtx({attachmentResolution: vi.fn().mockRejectedValue(new PgDatabaseNotFoundError('No databases.'))})

      await expect(getAll(ctx, 'app-1')).rejects.toBeInstanceOf(PgDatabaseNotFoundError)
    })

    it('binds the signal to the settings request', async () => {
      const {ctx, data} = buildCtx()
      const {signal} = new AbortController()

      await getAll(ctx, 'app-1', undefined, {signal})

      expect(data.withOptions).toHaveBeenCalledWith({signal})
    })

    it('rejects without a request when the signal is already aborted', async () => {
      const {attachmentResolution, ctx} = buildCtx()
      const controller = new AbortController()
      controller.abort()

      await expect(getAll(ctx, 'app-1', undefined, {signal: controller.signal})).rejects.toThrow()
      expect(attachmentResolution).not.toHaveBeenCalled()
    })
  })

  describe('get', () => {
    it('returns the one setting with the add-on', async () => {
      const {ctx} = buildCtx()

      const result = await get(ctx, 'app-1', 'log_statement', 'DATABASE_URL')

      expect(result).toEqual({addon: pgAttachment().addon, setting: SETTINGS.log_statement})
    })

    it('throws UnknownSettingError when the database has no such setting', async () => {
      const {ctx} = buildCtx()

      const error = await get(ctx, 'app-1', 'track_functions').catch(error_ => error_)

      expect(error).toBeInstanceOf(UnknownSettingError)
      expect(error.key).toBe('track_functions')
      expect(error.body).toEqual({id: 'unknown_database_setting', message: 'track_functions isn\'t a setting available on postgresql-db-1.'})
    })

    it('rejects Essential-tier databases', async () => {
      const {ctx} = buildCtx({attachmentResolution: vi.fn().mockResolvedValue([pgAttachment('heroku-postgresql:essential-1')])})

      await expect(get(ctx, 'app-1', 'log_statement')).rejects.toBeInstanceOf(EssentialDatabaseNotSupportedError)
    })
  })

  describe('update', () => {
    it('sends only the one key and returns the updated setting with the add-on', async () => {
      const {ctx, updateConfig} = buildCtx()

      const result = await update(ctx, 'app-1', 'log_lock_waits', true)

      // eslint-disable-next-line camelcase
      expect(updateConfig).toHaveBeenCalledWith('addon-1', {log_lock_waits: true})
      expect(result).toEqual({addon: pgAttachment().addon, setting: SETTINGS.log_lock_waits})
    })

    it('sends dotted auto_explain keys as-is', async () => {
      const setting = {default: 'text', desc: 'Format.', value: 'json'}
      const {ctx, updateConfig} = buildCtx({updateConfig: vi.fn().mockResolvedValue({'auto_explain.log_format': setting})})

      const result = await update(ctx, 'app-1', 'auto_explain.log_format', 'json', 'HEROKU_POSTGRESQL_RED')

      expect(updateConfig).toHaveBeenCalledWith('addon-1', {'auto_explain.log_format': 'json'})
      expect(result.setting).toEqual(setting)
    })

    it('throws UnknownSettingError when the response has no such setting', async () => {
      const {ctx} = buildCtx({updateConfig: vi.fn().mockResolvedValue({})})

      await expect(update(ctx, 'app-1', 'log_connections', false)).rejects.toBeInstanceOf(UnknownSettingError)
    })

    it('rejects Essential-tier databases without updating', async () => {
      const {ctx, updateConfig} = buildCtx({attachmentResolution: vi.fn().mockResolvedValue([pgAttachment('heroku-postgresql:essential-0')])})

      await expect(update(ctx, 'app-1', 'log_connections', false)).rejects.toBeInstanceOf(EssentialDatabaseNotSupportedError)
      expect(updateConfig).not.toHaveBeenCalled()
    })

    it('binds the signal to the update request', async () => {
      const {ctx, data} = buildCtx()
      const {signal} = new AbortController()

      await update(ctx, 'app-1', 'log_lock_waits', true, undefined, {signal})

      expect(data.withOptions).toHaveBeenCalledWith({signal})
    })
  })

  describe('extension', () => {
    it('exposes getAll, get, and update on data.databaseSettings', () => {
      const sdk = new HerokuSDK({extensions: [databaseSettingsExtensions]})

      expect(sdk.data.databaseSettings.getAll).toBeTypeOf('function')
      expect(sdk.data.databaseSettings.get).toBeTypeOf('function')
      expect(sdk.data.databaseSettings.update).toBeTypeOf('function')
    })
  })
})
