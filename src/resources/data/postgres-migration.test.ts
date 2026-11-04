/* eslint-disable camelcase */
import {HerokuApiError, NotFoundError} from '@heroku/heroku-fetch'
import {
  afterEach, describe, expect, it, vi,
} from 'vitest'

import type {ResourceCtx} from '../../core/extend-resource.js'
import type {Migration, MigrationStatus} from './postgres-migration.js'

import {getPostgresServiceName} from './internal/postgres-utils.js'
import {
  cancel,
  create,
  info,
  isCancellable,
  isRunnable,
  listMigrationContext,
  MigrationInvalidError,
  MigrationNotCancellableError,
  MigrationNotRunnableError,
  postgresMigrationExtensions,
  run,
} from './postgres-migration.js'

type Fn = ReturnType<typeof vi.fn>

const service = getPostgresServiceName()

function buildNotFound(): NotFoundError {
  const response = new Response(JSON.stringify({id: 'not_found'}), {
    headers: {'content-type': 'application/json'},
    status: 404,
  })
  return new NotFoundError(response, {id: 'not_found', resource: 'migration'})
}

function buildServerError(): HerokuApiError {
  return new HerokuApiError('boom', 500, new Response(null, {status: 500}), {id: 'server_error', message: 'boom'})
}

function buildMigration(overrides: Partial<Migration> = {}): Migration {
  return {
    auto_promote: false,
    cdc_lag: null,
    completed: false,
    full_load_progress: null,
    id: 'migration-1',
    preassessment_results: [],
    source_id: 'classic-addon',
    status: 'ready',
    status_description: 'Ready to migrate',
    successful: false,
    target_id: 'advanced-addon',
    ...overrides,
  }
}

/** A `version=3.sdk` attachment with the `addon:plan,config_vars` inclusions. */
function buildAttachment(opts: {
  addonId: string
  addonName: string
  appName?: string
  attachmentName: string
  planName: string
}) {
  return {
    addon: {
      app: {id: 'app-uuid', name: opts.appName ?? 'app-1'},
      id: opts.addonId,
      name: opts.addonName,
      plan: {name: opts.planName},
    },
    app: {id: 'app-uuid', name: 'app-1'},
    config_vars: [`${opts.attachmentName}_URL`],
    id: `att-${opts.attachmentName}`,
    name: opts.attachmentName,
  }
}

function buildCtx(opts: {
  listByApp?: Fn
  migrationCancel?: Fn
  migrationCreate?: Fn
  migrationInfo?: Fn
  postgresInfo?: Fn
} = {}): Pick<ResourceCtx, 'data' | 'platform'> {
  const data: Record<string, unknown> = {
    postgres: {info: opts.postgresInfo ?? vi.fn()},
    postgresMigration: {
      cancel: opts.migrationCancel ?? vi.fn().mockResolvedValue(),
      create: opts.migrationCreate ?? vi.fn(),
      info: opts.migrationInfo ?? vi.fn(),
      run: vi.fn().mockResolvedValue(),
    },
  }
  data.withOptions = vi.fn(() => data)

  const platform: Record<string, unknown> = {
    addOnAttachment: {listByApp: opts.listByApp ?? vi.fn().mockResolvedValue([])},
    withHeaders: vi.fn(() => platform),
    withOptions: vi.fn(() => platform),
  }

  return {data: data as never, platform: platform as never}
}

describe('postgresMigrationExtensions factory', () => {
  it('exposes cancel, create, info, listMigrationContext and run', () => {
    const methods = postgresMigrationExtensions.factory({data: {} as never, platform: {} as never})
    expect(typeof methods.cancel).toBe('function')
    expect(typeof methods.create).toBe('function')
    expect(typeof methods.info).toBe('function')
    expect(typeof methods.listMigrationContext).toBe('function')
    expect(typeof methods.run).toBe('function')
  })
})

describe('isRunnable / isCancellable', () => {
  const statuses: MigrationStatus[] = [
    'creating_target',
    'preparing',
    'migrating',
    'completed',
    'failed',
    'cancelled',
    'ready',
    'promoting',
    'unknown',
  ]

  it('allow only the ready status', () => {
    for (const status of statuses) {
      const expected = status === 'ready'
      expect(isRunnable(status)).toBe(expected)
      expect(isCancellable(status)).toBe(expected)
    }
  })
})

describe('info', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  it('returns the migration targeting the add-on', async () => {
    const migration = buildMigration()
    const migrationInfo = vi.fn().mockResolvedValue(migration)
    const ctx = buildCtx({migrationInfo})

    await expect(info(ctx, 'advanced-addon')).resolves.toBe(migration)
    expect(migrationInfo).toHaveBeenCalledExactlyOnceWith('advanced-addon')
  })

  it('maps a 404 (no migration) to undefined', async () => {
    const migrationInfo = vi.fn().mockRejectedValue(buildNotFound())
    const ctx = buildCtx({migrationInfo})

    await expect(info(ctx, 'advanced-addon')).resolves.toBeUndefined()
  })

  it('rethrows non-404 errors', async () => {
    const migrationInfo = vi.fn().mockRejectedValue(buildServerError())
    const ctx = buildCtx({migrationInfo})

    await expect(info(ctx, 'advanced-addon')).rejects.toBeInstanceOf(HerokuApiError)
  })

  it('throws immediately if the signal is already aborted', async () => {
    const migrationInfo = vi.fn()
    const ctx = buildCtx({migrationInfo})
    const controller = new AbortController()
    controller.abort()

    await expect(info(ctx, 'advanced-addon', {signal: controller.signal})).rejects.toThrow()
    expect(migrationInfo).not.toHaveBeenCalled()
  })
})

describe('create', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  it('posts the create body against the target add-on', async () => {
    const result = buildMigration({status: 'creating_target'})
    const migrationCreate = vi.fn().mockResolvedValue(result)
    const ctx = buildCtx({migrationCreate})

    const created = await create(ctx, 'advanced-addon', {method: 'cdc', source_id: 'classic-addon'})

    expect(migrationCreate).toHaveBeenCalledExactlyOnceWith('advanced-addon', {method: 'cdc', source_id: 'classic-addon'})
    expect(created).toBe(result)
  })

  it('rejects a source that equals the target before any request', async () => {
    const migrationCreate = vi.fn()
    const ctx = buildCtx({migrationCreate})

    const error = await create(ctx, 'same-addon', {source_id: 'same-addon'}).catch((error_: unknown) => error_)

    expect(error).toBeInstanceOf(MigrationInvalidError)
    expect((error as MigrationInvalidError).reason).toBe('source_equals_target')
    expect(migrationCreate).not.toHaveBeenCalled()
  })

  it('throws immediately if the signal is already aborted', async () => {
    const migrationCreate = vi.fn()
    const ctx = buildCtx({migrationCreate})
    const controller = new AbortController()
    controller.abort()

    await expect(create(ctx, 'advanced-addon', {source_id: 'classic-addon'}, {signal: controller.signal})).rejects.toThrow()
    expect(migrationCreate).not.toHaveBeenCalled()
  })
})

describe('run', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  it('gates on the ready status, runs, and returns the migration it acted on', async () => {
    const migration = buildMigration({status: 'ready'})
    const migrationInfo = vi.fn().mockResolvedValue(migration)
    const ctx = buildCtx({migrationInfo})
    const {run: routeRun} = (ctx.data as unknown as {postgresMigration: {run: Fn}}).postgresMigration

    const acted = await run(ctx, 'advanced-addon')

    expect(migrationInfo).toHaveBeenCalledExactlyOnceWith('advanced-addon')
    expect(routeRun).toHaveBeenCalledExactlyOnceWith('advanced-addon')
    expect(acted).toBe(migration)
  })

  it('throws MigrationNotRunnableError (carrying the migration) without running when not ready', async () => {
    const migration = buildMigration({status: 'migrating'})
    const migrationInfo = vi.fn().mockResolvedValue(migration)
    const ctx = buildCtx({migrationInfo})
    const {run: routeRun} = (ctx.data as unknown as {postgresMigration: {run: Fn}}).postgresMigration

    const error = await run(ctx, 'advanced-addon').catch((error_: unknown) => error_)

    expect(error).toBeInstanceOf(MigrationNotRunnableError)
    expect((error as MigrationNotRunnableError).migration).toBe(migration)
    expect((error as MigrationNotRunnableError).status).toBe('migrating')
    expect(routeRun).not.toHaveBeenCalled()
  })

  it('propagates a 404 (migration already gone)', async () => {
    const migrationInfo = vi.fn().mockRejectedValue(buildNotFound())
    const ctx = buildCtx({migrationInfo})

    await expect(run(ctx, 'advanced-addon')).rejects.toBeInstanceOf(NotFoundError)
  })
})

describe('cancel', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  it('gates on the ready status, cancels, and returns the migration it acted on', async () => {
    const migration = buildMigration({status: 'ready'})
    const migrationInfo = vi.fn().mockResolvedValue(migration)
    const migrationCancel = vi.fn().mockResolvedValue()
    const ctx = buildCtx({migrationCancel, migrationInfo})

    const acted = await cancel(ctx, 'advanced-addon')

    expect(migrationCancel).toHaveBeenCalledExactlyOnceWith('advanced-addon')
    expect(acted).toBe(migration)
  })

  it('throws MigrationNotCancellableError (carrying the migration) without canceling when not ready', async () => {
    const migration = buildMigration({status: 'completed'})
    const migrationInfo = vi.fn().mockResolvedValue(migration)
    const migrationCancel = vi.fn()
    const ctx = buildCtx({migrationCancel, migrationInfo})

    const error = await cancel(ctx, 'advanced-addon').catch((error_: unknown) => error_)

    expect(error).toBeInstanceOf(MigrationNotCancellableError)
    expect((error as MigrationNotCancellableError).migration).toBe(migration)
    expect((error as MigrationNotCancellableError).status).toBe('completed')
    expect(migrationCancel).not.toHaveBeenCalled()
  })
})

describe('listMigrationContext', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  it('classifies sources/targets, dedupes add-ons, and groups attachment names', async () => {
    const listByApp = vi.fn().mockResolvedValue([
      buildAttachment({
        addonId: 'classic-1', addonName: 'postgres-classic', attachmentName: 'DATABASE', planName: `${service}:standard-0`,
      }),
      buildAttachment({
        addonId: 'classic-1', addonName: 'postgres-classic', attachmentName: 'HEROKU_POSTGRESQL_PURPLE', planName: `${service}:standard-0`,
      }),
      buildAttachment({
        addonId: 'essential-1', addonName: 'postgres-essential', attachmentName: 'ESSENTIAL', planName: `${service}:essential-0`,
      }),
      buildAttachment({
        addonId: 'advanced-1', addonName: 'postgres-advanced', attachmentName: 'ADVANCED', planName: `${service}:advanced-0`,
      }),
      buildAttachment({
        addonId: 'not-pg', addonName: 'redis-thing', attachmentName: 'REDIS', planName: 'heroku-redis:mini',
      }),
    ])
    const migrationInfo = vi.fn().mockRejectedValue(buildNotFound())
    const postgresInfo = vi.fn().mockResolvedValue({addon: {id: 'advanced-1'}, status: 'available'})
    const ctx = buildCtx({listByApp, migrationInfo, postgresInfo})

    const {migrations, sources, targets} = await listMigrationContext(ctx, 'app-1')

    // Inclusion header is sent so plans are present for classification.
    expect(ctx.platform.withHeaders).toHaveBeenCalledWith({'Accept-Inclusion': 'addon:plan,config_vars'})

    // classic non-essential → source (Redis + essential excluded); deduped with both names.
    expect(sources).toHaveLength(1)
    expect(sources[0].id).toBe('classic-1')
    expect(sources[0].attachmentNames).toEqual(['DATABASE', 'HEROKU_POSTGRESQL_PURPLE'])

    // advanced → target
    expect(targets).toHaveLength(1)
    expect(targets[0].id).toBe('advanced-1')
    expect(targets[0].info).toEqual({addon: {id: 'advanced-1'}, status: 'available'})
    expect(targets[0].migration).toBeUndefined()
    expect(migrations).toEqual([])
  })

  it('excludes databases owned by another app', async () => {
    const listByApp = vi.fn().mockResolvedValue([
      buildAttachment({
        addonId: 'owned', addonName: 'postgres-owned', appName: 'app-1', attachmentName: 'DATABASE', planName: `${service}:advanced-0`,
      }),
      buildAttachment({
        addonId: 'foreign', addonName: 'postgres-foreign', appName: 'other-app', attachmentName: 'SHARED', planName: `${service}:advanced-0`,
      }),
    ])
    const migrationInfo = vi.fn().mockRejectedValue(buildNotFound())
    const postgresInfo = vi.fn().mockResolvedValue({status: 'available'})
    const ctx = buildCtx({listByApp, migrationInfo, postgresInfo})

    const {targets} = await listMigrationContext(ctx, 'app-1')

    expect(targets.map(t => t.id)).toEqual(['owned'])
  })

  it('attaches per-target migration + info and collects the flat migrations list', async () => {
    const listByApp = vi.fn().mockResolvedValue([
      buildAttachment({
        addonId: 'adv-1', addonName: 'pg-adv-1', attachmentName: 'ADV1', planName: `${service}:advanced-0`,
      }),
      buildAttachment({
        addonId: 'adv-2', addonName: 'pg-adv-2', attachmentName: 'ADV2', planName: `${service}:advanced-0`,
      }),
    ])
    const migration = buildMigration({id: 'm-adv-1', target_id: 'adv-1'})
    // adv-1 has a migration; adv-2 has none (404).
    const migrationInfo = vi.fn()
      .mockResolvedValueOnce(migration)
      .mockRejectedValueOnce(buildNotFound())
    const postgresInfo = vi.fn()
      .mockResolvedValueOnce({status: 'available'})
      .mockResolvedValueOnce({status: 'provisioning'})
    const ctx = buildCtx({listByApp, migrationInfo, postgresInfo})

    const {migrations, targets} = await listMigrationContext(ctx, 'app-1')

    expect(targets[0].migration).toBe(migration)
    expect(targets[1].migration).toBeUndefined()
    expect(targets[1].info).toEqual({status: 'provisioning'})
    expect(migrations).toEqual([migration])
  })

  it('rethrows the first non-404 rejection from the fan-out', async () => {
    const listByApp = vi.fn().mockResolvedValue([
      buildAttachment({
        addonId: 'adv-1', addonName: 'pg-adv-1', attachmentName: 'ADV1', planName: `${service}:advanced-0`,
      }),
    ])
    const migrationInfo = vi.fn().mockRejectedValue(buildServerError())
    const postgresInfo = vi.fn().mockRejectedValue(buildNotFound())
    const ctx = buildCtx({listByApp, migrationInfo, postgresInfo})

    await expect(listMigrationContext(ctx, 'app-1')).rejects.toBeInstanceOf(HerokuApiError)
  })

  it('throws immediately if the signal is already aborted', async () => {
    const listByApp = vi.fn()
    const ctx = buildCtx({listByApp})
    const controller = new AbortController()
    controller.abort()

    await expect(listMigrationContext(ctx, 'app-1', {signal: controller.signal})).rejects.toThrow()
    expect(listByApp).not.toHaveBeenCalled()
  })
})
