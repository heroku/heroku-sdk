/* eslint-disable camelcase */
import {
  afterEach, describe, expect, it, vi,
} from 'vitest'

import type {ResourceCtx} from '../../../core/extend-resource.js'

import {HerokuSDK} from '../../../index.js'
import {EssentialDatabaseNotSupportedError} from '../internal/postgres-utils.js'
import {PgDatabaseNotFoundError} from '../internal/resolve-pg-database.js'
import {
  AdvancedDatabaseNotSupportedError, databaseSettingsExtensions, get, getAll, UnknownDatabaseSettingError, update,
} from './index.js'

type Mock = ReturnType<typeof vi.fn>

function pgAttachment(plan = 'heroku-postgresql:standard-0') {
  return {
    addon: {
      app: {id: 'app-1-uuid', name: 'app-1'}, id: 'addon-1', name: 'postgresql-db-1', plan: {name: plan},
    },
    app: {id: 'app-1-uuid', name: 'app-1'},
    config_vars: ['DATABASE_URL'],
    id: 'att-1',
    name: 'DATABASE',
  }
}

const ADDON = {id: 'addon-1', name: 'postgresql-db-1'}

const SETTINGS = {
  log_lock_waits: {default: false, desc: 'Log lock waits.', value: true},
  log_min_duration_statement: {default: -1, desc: 'Log slow statements.', value: 0},
  log_statement: {
    default: 'none', desc: 'Statements to log.', value: 'ddl', values: {ddl: 'DDL statements are logged.', none: 'Nothing is logged.'},
  },
  track_functions: {default: 'none', desc: 'Track functions.', value: false},
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
    platform: platform as {withOptions: Mock},
    updateConfig,
  }
}

function aborted() {
  const controller = new AbortController()
  controller.abort()
  return controller.signal
}

const json = (body: unknown) => new Response(JSON.stringify(body), {headers: {'content-type': 'application/json'}})

const resolvesWith = (addonAttachment: string) => ({addon_attachment: addonAttachment, app: 'app-1'})

const ESSENTIAL_PLANS = ['heroku-postgresql:essential-0', 'heroku-postgresql:mini', 'heroku-postgresql:basic']
const ADVANCED_PLANS = ['heroku-postgresql:advanced-beta', 'heroku-postgresql:performance-beta']

describe('databaseSettings resource', () => {
  describe('getAll', () => {
    it('resolves DATABASE_URL by default and returns every setting with the add-on', async () => {
      const {attachmentResolution, config, ctx} = buildCtx()

      const result = await getAll(ctx, 'app-1')

      expect(attachmentResolution).toHaveBeenCalledExactlyOnceWith(resolvesWith('DATABASE_URL'))
      expect(config).toHaveBeenCalledExactlyOnceWith('addon-1')
      expect(result).toEqual({addon: ADDON, settings: SETTINGS})
    })

    it('resolves the given database identity', async () => {
      const {attachmentResolution, ctx} = buildCtx()

      await getAll(ctx, 'app-1', 'HEROKU_POSTGRESQL_RED')

      expect(attachmentResolution).toHaveBeenCalledExactlyOnceWith(resolvesWith('HEROKU_POSTGRESQL_RED'))
    })

    it.each(ESSENTIAL_PLANS)('rejects %s with EssentialDatabaseNotSupportedError before fetching settings', async plan => {
      const {config, ctx} = buildCtx({attachmentResolution: vi.fn().mockResolvedValue([pgAttachment(plan)])})

      const error = await getAll(ctx, 'app-1').catch(error_ => error_)

      expect(error).toBeInstanceOf(EssentialDatabaseNotSupportedError)
      expect(error.message).toBe('Database settings aren\'t supported on Essential-tier databases. postgresql-db-1 is an Essential-tier database.')
      expect(error.addon.name).toBe('postgresql-db-1')
      expect(config).not.toHaveBeenCalled()
    })

    it.each(ADVANCED_PLANS)('rejects %s with AdvancedDatabaseNotSupportedError before fetching settings', async plan => {
      const {config, ctx} = buildCtx({attachmentResolution: vi.fn().mockResolvedValue([pgAttachment(plan)])})

      const error = await getAll(ctx, 'app-1').catch(error_ => error_)

      expect(error).toBeInstanceOf(AdvancedDatabaseNotSupportedError)
      expect(error.body).toEqual({
        id: 'advanced_database_not_supported',
        message: 'These database settings aren\'t supported on Advanced-tier databases. postgresql-db-1 is an Advanced-tier database.',
      })
      expect(error.addon).toEqual(ADDON)
      expect(config).not.toHaveBeenCalled()
    })

    it('surfaces PgDatabaseNotFoundError when the app has no databases', async () => {
      const {ctx} = buildCtx({attachmentResolution: vi.fn().mockRejectedValue(new PgDatabaseNotFoundError('No databases.'))})

      await expect(getAll(ctx, 'app-1')).rejects.toBeInstanceOf(PgDatabaseNotFoundError)
    })

    it('binds the signal to the resolution and settings requests', async () => {
      const {ctx, data, platform} = buildCtx()
      const {signal} = new AbortController()

      await getAll(ctx, 'app-1', undefined, {signal})

      expect(platform.withOptions).toHaveBeenCalledWith({signal})
      expect(data.withOptions).toHaveBeenCalledWith({signal})
    })

    it('rejects without a request when the signal is already aborted', async () => {
      const {attachmentResolution, config, ctx} = buildCtx()

      await expect(getAll(ctx, 'app-1', undefined, {signal: aborted()})).rejects.toThrow()
      expect(attachmentResolution).not.toHaveBeenCalled()
      expect(config).not.toHaveBeenCalled()
    })
  })

  describe('get', () => {
    it('returns the one setting with its key and the add-on', async () => {
      const {ctx} = buildCtx()

      const result = await get(ctx, 'app-1', 'log_statement')

      expect(result).toEqual({addon: ADDON, key: 'log_statement', setting: SETTINGS.log_statement})
    })

    it('resolves the given database identity', async () => {
      const {attachmentResolution, ctx} = buildCtx()

      await get(ctx, 'app-1', 'log_statement', 'HEROKU_POSTGRESQL_RED')

      expect(attachmentResolution).toHaveBeenCalledExactlyOnceWith(resolvesWith('HEROKU_POSTGRESQL_RED'))
    })

    it.each([
      ['track_functions', false],
      ['log_min_duration_statement', 0],
    ] as const)('returns %s when its value is falsy (%s)', async (key, value) => {
      const {ctx} = buildCtx()

      const result = await get(ctx, 'app-1', key)

      expect(result.setting.value).toBe(value)
    })

    it('throws UnknownDatabaseSettingError when the database has no such setting', async () => {
      const {ctx} = buildCtx({config: vi.fn().mockResolvedValue({log_statement: SETTINGS.log_statement})})

      const error = await get(ctx, 'app-1', 'track_functions').catch(error_ => error_)

      expect(error).toBeInstanceOf(UnknownDatabaseSettingError)
      expect(error.key).toBe('track_functions')
      expect(error.addon).toEqual(ADDON)
      expect(error.body).toEqual({id: 'unknown_database_setting', message: 'track_functions isn\'t a setting available on postgresql-db-1.'})
    })

    it('rejects Essential-tier databases', async () => {
      const {ctx} = buildCtx({attachmentResolution: vi.fn().mockResolvedValue([pgAttachment('heroku-postgresql:essential-1')])})

      await expect(get(ctx, 'app-1', 'log_statement')).rejects.toBeInstanceOf(EssentialDatabaseNotSupportedError)
    })

    it('rejects Advanced-tier databases', async () => {
      const {ctx} = buildCtx({attachmentResolution: vi.fn().mockResolvedValue([pgAttachment('heroku-postgresql:advanced-beta')])})

      await expect(get(ctx, 'app-1', 'log_statement')).rejects.toBeInstanceOf(AdvancedDatabaseNotSupportedError)
    })

    it('binds the signal to the resolution and settings requests', async () => {
      const {ctx, data, platform} = buildCtx()
      const {signal} = new AbortController()

      await get(ctx, 'app-1', 'log_statement', undefined, {signal})

      expect(platform.withOptions).toHaveBeenCalledWith({signal})
      expect(data.withOptions).toHaveBeenCalledWith({signal})
    })

    it('rejects without a request when the signal is already aborted', async () => {
      const {attachmentResolution, config, ctx} = buildCtx()

      await expect(get(ctx, 'app-1', 'log_statement', undefined, {signal: aborted()})).rejects.toThrow()
      expect(attachmentResolution).not.toHaveBeenCalled()
      expect(config).not.toHaveBeenCalled()
    })
  })

  describe('update', () => {
    it('sends only the one key and returns the updated setting with its key and the add-on', async () => {
      const {attachmentResolution, ctx, updateConfig} = buildCtx()

      const result = await update(ctx, 'app-1', 'log_lock_waits', true)

      expect(attachmentResolution).toHaveBeenCalledExactlyOnceWith(resolvesWith('DATABASE_URL'))
      expect(updateConfig).toHaveBeenCalledExactlyOnceWith('addon-1', {log_lock_waits: true})
      expect(result).toEqual({addon: ADDON, key: 'log_lock_waits', setting: SETTINGS.log_lock_waits})
    })

    it('resolves the given database identity and sends dotted auto_explain keys as-is', async () => {
      const setting = {default: 'text', desc: 'Format.', value: 'json'}
      const {attachmentResolution, ctx, updateConfig} = buildCtx({updateConfig: vi.fn().mockResolvedValue({'auto_explain.log_format': setting})})

      const result = await update(ctx, 'app-1', 'auto_explain.log_format', 'json', 'HEROKU_POSTGRESQL_RED')

      expect(attachmentResolution).toHaveBeenCalledExactlyOnceWith(resolvesWith('HEROKU_POSTGRESQL_RED'))
      expect(updateConfig).toHaveBeenCalledExactlyOnceWith('addon-1', {'auto_explain.log_format': 'json'})
      expect(result.setting).toEqual(setting)
    })

    it.each([
      ['track_functions', false],
      ['log_min_duration_statement', 0],
    ] as const)('sends and returns %s when its value is falsy (%s)', async (key, value) => {
      const {ctx, updateConfig} = buildCtx()

      const result = await update(ctx, 'app-1', key, value as never)

      expect(updateConfig).toHaveBeenCalledExactlyOnceWith('addon-1', {[key]: value})
      expect(result.setting.value).toBe(value)
    })

    it('throws UnknownDatabaseSettingError saying the change is unconfirmed when the response has no such setting', async () => {
      const {ctx} = buildCtx({updateConfig: vi.fn().mockResolvedValue({})})

      const error = await update(ctx, 'app-1', 'log_connections', false).catch(error_ => error_)

      expect(error).toBeInstanceOf(UnknownDatabaseSettingError)
      expect(error.key).toBe('log_connections')
      expect(error.addon).toEqual(ADDON)
      expect(error.message).toBe('The update to log_connections was sent to postgresql-db-1, but the response didn\'t include log_connections, so the change couldn\'t be confirmed.')
    })

    it('rejects Essential-tier databases without updating', async () => {
      const {ctx, updateConfig} = buildCtx({attachmentResolution: vi.fn().mockResolvedValue([pgAttachment('heroku-postgresql:essential-0')])})

      await expect(update(ctx, 'app-1', 'log_connections', false)).rejects.toBeInstanceOf(EssentialDatabaseNotSupportedError)
      expect(updateConfig).not.toHaveBeenCalled()
    })

    it('rejects Advanced-tier databases without updating', async () => {
      const {ctx, updateConfig} = buildCtx({attachmentResolution: vi.fn().mockResolvedValue([pgAttachment('heroku-postgresql:advanced-beta')])})

      await expect(update(ctx, 'app-1', 'log_connections', false)).rejects.toBeInstanceOf(AdvancedDatabaseNotSupportedError)
      expect(updateConfig).not.toHaveBeenCalled()
    })

    it('binds the signal to the resolution and update requests', async () => {
      const {ctx, data, platform} = buildCtx()
      const {signal} = new AbortController()

      await update(ctx, 'app-1', 'log_lock_waits', true, undefined, {signal})

      expect(platform.withOptions).toHaveBeenCalledWith({signal})
      expect(data.withOptions).toHaveBeenCalledWith({signal})
    })

    it('sends nothing when the signal is already aborted', async () => {
      const {attachmentResolution, ctx, updateConfig} = buildCtx()

      await expect(update(ctx, 'app-1', 'log_lock_waits', true, undefined, {signal: aborted()})).rejects.toThrow()
      expect(attachmentResolution).not.toHaveBeenCalled()
      expect(updateConfig).not.toHaveBeenCalled()
    })
  })

  describe('extension', () => {
    afterEach(() => {
      vi.unstubAllGlobals()
      vi.unstubAllEnvs()
    })

    it('wires data.databaseSettings through the SDK clients to the settings endpoints', async () => {
      const requests: string[] = []
      vi.stubEnv('HEROKU_DATA_HOST', '')
      vi.stubEnv('HEROKU_POSTGRESQL_HOST', '')
      vi.stubGlobal('fetch', vi.fn<typeof globalThis.fetch>(async (input, init) => {
        const request = input instanceof Request ? input : new Request(input, init)
        requests.push(`${request.method} ${request.url}`)

        if (request.url === 'https://api.heroku.com/actions/addon-attachments/resolve') return json([pgAttachment()])
        if (request.url === 'https://api.data.heroku.com/postgres/v0/databases/addon-1/config') return json(SETTINGS)
        throw new Error(`Unexpected network request: ${request.method} ${request.url}`)
      }))
      const sdk = new HerokuSDK({clientOptions: {token: 'test-token'}, extensions: [databaseSettingsExtensions]})

      await expect(sdk.data.databaseSettings.getAll('app-1')).resolves.toEqual({addon: ADDON, settings: SETTINGS})
      await expect(sdk.data.databaseSettings.get('app-1', 'log_statement')).resolves.toMatchObject({key: 'log_statement'})
      await expect(sdk.data.databaseSettings.update('app-1', 'log_lock_waits', true)).resolves.toMatchObject({key: 'log_lock_waits'})

      expect(requests).toEqual([
        'POST https://api.heroku.com/actions/addon-attachments/resolve',
        'GET https://api.data.heroku.com/postgres/v0/databases/addon-1/config',
        'POST https://api.heroku.com/actions/addon-attachments/resolve',
        'GET https://api.data.heroku.com/postgres/v0/databases/addon-1/config',
        'POST https://api.heroku.com/actions/addon-attachments/resolve',
        'PATCH https://api.data.heroku.com/postgres/v0/databases/addon-1/config',
      ])
    })
  })
})
