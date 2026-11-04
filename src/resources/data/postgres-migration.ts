import type {
  PostgresInfoResult,
  PostgresMigrationCreateOpts,
  PostgresMigrationCreateResult,
  PostgresMigrationInfoResult,
} from '@heroku/types/data'

import {NotFoundError} from '@heroku/heroku-fetch'

import type {ResourceCtx} from '../../core/extend-resource.js'
import type {AddOnAttachmentWithInclusions} from '../platform/add-on-attachment/resolve.js'

import {extendResource} from '../../core/extend-resource.js'
import {withSignal} from '../../core/with-signal.js'
import {
  isAdvancedDatabase, isEssentialDatabase, isLegacyDatabase, isPostgresAddon,
} from './internal/postgres-utils.js'

/**
 * A database migration record. Create and Info responses are structurally
 * identical (same fields, same closed `status` union), so one shared alias
 * carries both — don't pass a value typed as one where the other is expected
 * beyond this alias.
 */
export type Migration = PostgresMigrationInfoResult

/** The closed migration-status union, re-derived so callers don't restate it. */
export type MigrationStatus = Migration['status']

/** Request body for configuring a migration (the generated create opts). */
export type MigrationCreateBody = PostgresMigrationCreateOpts

export type MigrationOptions = {
  signal?: AbortSignal
}

/**
 * The reason a migration create request was rejected client-side. A
 * single-member discriminated union today; new guards add members here so
 * callers keep exhaustive handling. Server-side validation rejections are not
 * yet mapped onto this type — they surface as the raw API error.
 */
export type MigrationInvalidReason = 'source_equals_target'

/**
 * A classic Postgres database eligible to be migrated *from*, with the names
 * it's attached under on the app.
 */
export type MigrationSource = AddOnAttachmentWithInclusions['addon'] & {
  attachmentNames: string[]
}

/**
 * An Advanced Postgres database eligible to be migrated *to*, with its
 * attachment names, its current `info` (for availability gating), and any
 * migration currently targeting it. `info`/`migration` are absent when the
 * database's `/info` or `/migrations` endpoint 404s (not yet a target).
 */
export type MigrationTarget = AddOnAttachmentWithInclusions['addon'] & {
  attachmentNames: string[]
  info?: PostgresInfoResult
  migration?: Migration
}

export type MigrationContext = {
  /** All migration records currently configured on the app's Advanced databases. */
  migrations: Migration[]
  /** Classic (non-Essential) databases that can be migration sources. */
  sources: MigrationSource[]
  /** Advanced databases that can be migration targets. */
  targets: MigrationTarget[]
}

/**
 * Thrown by `create` when the migration inputs are invalid before any request
 * fires. Carries a machine `reason` so callers can branch without string
 * matching.
 */
export class MigrationInvalidError extends Error {
  public readonly id = 'migration_invalid'

  constructor(public readonly reason: MigrationInvalidReason, message: string) {
    super(message)
    this.name = 'MigrationInvalidError'
  }

  public get body() {
    return {id: this.id, message: this.message, reason: this.reason}
  }
}

/**
 * Thrown by `run` when the migration isn't in a startable state. Carries the
 * migration (and thus its `status`) so callers can report the drift without
 * re-fetching.
 */
export class MigrationNotRunnableError extends Error {
  public readonly id = 'migration_not_runnable'

  constructor(public readonly migration: Migration) {
    super(`Migration ${migration.id} can't be started from status '${migration.status}'. Only migrations in the 'ready' status can be started.`)
    this.name = 'MigrationNotRunnableError'
  }

  public get body() {
    return {id: this.id, message: this.message, status: this.migrationStatus}
  }

  /**
   * The migration's status. Named `migrationStatus` (not `status`) to avoid
   * shadowing the HTTP-status convention other `Error` subclasses in the SDK
   * carry.
   */
  public get migrationStatus(): MigrationStatus {
    return this.migration.status
  }
}

/**
 * Thrown by `cancel` when the migration isn't in a cancellable state. Carries
 * the migration (and thus its `status`).
 */
export class MigrationNotCancellableError extends Error {
  public readonly id = 'migration_not_cancellable'

  constructor(public readonly migration: Migration) {
    super(`Migration ${migration.id} can't be canceled from status '${migration.status}'. Only migrations in the 'ready' status can be canceled.`)
    this.name = 'MigrationNotCancellableError'
  }

  public get body() {
    return {id: this.id, message: this.message, status: this.migrationStatus}
  }

  /**
   * The migration's status. Named `migrationStatus` (not `status`) to avoid
   * shadowing the HTTP-status convention other `Error` subclasses in the SDK
   * carry.
   */
  public get migrationStatus(): MigrationStatus {
    return this.migration.status
  }
}

/**
 * Compile-time exhaustiveness guard with a safe runtime fallback. A newly
 * generated `MigrationStatus` that isn't handled above is a type error here
 * (the `never` parameter), but if one reaches this at runtime — e.g. the API
 * returns a status the type doesn't yet know about — we return `fallback`
 * rather than throwing, so `run`/`cancel` fail closed (treat it as not
 * runnable/cancellable) instead of crashing.
 */
function exhaustiveFallback<T>(_status: never, fallback: T): T {
  return fallback
}

/**
 * Whether a migration can be started. Only `ready` migrations are runnable,
 * matching the CLI's menu gate. The exhaustive `switch` makes a newly
 * generated status a compile error until its policy is decided here, rather
 * than silently defaulting to runnable or not.
 */
export function isRunnable(status: MigrationStatus): boolean {
  switch (status) {
    case 'cancelled':
    case 'completed':
    case 'creating_target':
    case 'failed':
    case 'migrating':
    case 'preparing':
    case 'promoting':
    case 'unknown': {
      return false
    }

    case 'ready': {
      return true
    }

    default: {
      return exhaustiveFallback(status, false)
    }
  }
}

/**
 * Whether a migration can be canceled. Only `ready` migrations are
 * cancellable, matching the CLI's menu gate. Exhaustive for the same reason as
 * {@link isRunnable}.
 */
export function isCancellable(status: MigrationStatus): boolean {
  switch (status) {
    case 'cancelled':
    case 'completed':
    case 'creating_target':
    case 'failed':
    case 'migrating':
    case 'preparing':
    case 'promoting':
    case 'unknown': {
      return false
    }

    case 'ready': {
      return true
    }

    default: {
      return exhaustiveFallback(status, false)
    }
  }
}

/**
 * Fetches the migration currently targeting `targetAddonId`.
 *
 * The data API's migration endpoint is a single-object `GET` (not a list);
 * when no migration exists it 404s, which this surfaces as `undefined` rather
 * than throwing, so callers can treat "no migration" as a normal state.
 */
export async function info(
  ctx: Pick<ResourceCtx, 'data'>,
  targetAddonId: string,
  options: MigrationOptions = {},
): Promise<Migration | undefined> {
  const {signal} = options
  signal?.throwIfAborted()

  try {
    return await withSignal(ctx.data, signal).postgresMigration.info(targetAddonId)
  } catch (error) {
    if (error instanceof NotFoundError) return undefined
    throw error
  }
}

/**
 * Configures a new migration *to* `targetAddonId` *from* the database named in
 * `body.source_id`.
 *
 * The URL identifies the **target**; the body's `source_id` identifies the
 * **source** — both are add-on ids, so the two are easy to swap. A
 * client-side guard rejects a source that equals the target before any request
 * fires.
 */
export async function create(
  ctx: Pick<ResourceCtx, 'data'>,
  targetAddonId: string,
  body: MigrationCreateBody,
  options: MigrationOptions = {},
): Promise<PostgresMigrationCreateResult> {
  const {signal} = options
  signal?.throwIfAborted()

  if (body.source_id === targetAddonId) {
    throw new MigrationInvalidError('source_equals_target', `A migration's source and target must differ, but both are '${targetAddonId}'.`)
  }

  return withSignal(ctx.data, signal).postgresMigration.create(targetAddonId, body)
}

/**
 * Best-effort re-fetch of a migration after a successful `run`/`cancel` POST so
 * the returned status reflects the transition the action kicked off.
 *
 * The POST already succeeded by the time this runs, so the re-fetch must never
 * turn a completed action into a thrown error: the caller's `signal` is
 * deliberately *not* threaded in (a post-POST abort shouldn't surface as a
 * failure of an action that already happened), and any re-fetch error is
 * swallowed. When the migration can't be re-read — it 404s (already gone) or
 * the re-fetch fails for any other reason — we fall back to the gated record
 * with its status forced to `'unknown'` rather than returning the stale
 * `'ready'` the gate observed, which would wrongly imply the action never ran.
 */
async function refetchAfterAction(
  ctx: Pick<ResourceCtx, 'data'>,
  targetAddonId: string,
  gated: Migration,
): Promise<Migration> {
  try {
    const refreshed = await info(ctx, targetAddonId)
    return refreshed ?? {...gated, status: 'unknown'}
  } catch {
    return {...gated, status: 'unknown'}
  }
}

/**
 * Starts the migration targeting `targetAddonId`.
 *
 * Fetches the migration first and gates on its status — a defensive backstop
 * against state drift between listing and action: throws
 * `MigrationNotRunnableError` (carrying the migration) if it's no longer
 * `ready`, and lets a `NotFoundError` propagate if the migration is already
 * gone. Once the run POST succeeds, returns the migration's post-action state
 * via a best-effort re-fetch (see {@link refetchAfterAction}); never throws
 * after the action has fired.
 */
export async function run(
  ctx: Pick<ResourceCtx, 'data'>,
  targetAddonId: string,
  options: MigrationOptions = {},
): Promise<Migration> {
  const {signal} = options
  signal?.throwIfAborted()

  const data = withSignal(ctx.data, signal)
  const migration = await data.postgresMigration.info(targetAddonId)

  if (!isRunnable(migration.status)) {
    throw new MigrationNotRunnableError(migration)
  }

  signal?.throwIfAborted()
  await data.postgresMigration.run(targetAddonId)

  return refetchAfterAction(ctx, targetAddonId, migration)
}

/**
 * Cancels the migration targeting `targetAddonId`.
 *
 * Gates on status like {@link run}: throws `MigrationNotCancellableError`
 * (carrying the migration) if it's not `ready`, and lets a `NotFoundError`
 * propagate if the migration is already gone. Once the cancel POST succeeds,
 * returns the migration's post-action state via a best-effort re-fetch (see
 * {@link refetchAfterAction}); never throws after the action has fired.
 */
export async function cancel(
  ctx: Pick<ResourceCtx, 'data'>,
  targetAddonId: string,
  options: MigrationOptions = {},
): Promise<Migration> {
  const {signal} = options
  signal?.throwIfAborted()

  const data = withSignal(ctx.data, signal)
  const migration = await data.postgresMigration.info(targetAddonId)

  if (!isCancellable(migration.status)) {
    throw new MigrationNotCancellableError(migration)
  }

  signal?.throwIfAborted()
  await data.postgresMigration.cancel(targetAddonId)

  return refetchAfterAction(ctx, targetAddonId, migration)
}

/**
 * Lists everything the migration UI needs for an app in one pass: the classic
 * databases that can be sources, the Advanced databases that can be targets
 * (each with its `info` and any migration targeting it), and the flat list of
 * configured migrations.
 *
 * Replaces the CLI's `getAppDatabases` + `getMigrationTargetsAndInfo`: resolves
 * the app's add-on attachments (with `addon:plan,config_vars` inclusions so
 * plans are present for tier classification), keeps only Postgres databases
 * the app owns, dedupes to unique add-ons with their attachment names, then
 * fans out `/migrations` and `/info` per Advanced database. A per-database 404
 * is tolerated (that database simply isn't a migration target yet); the first
 * non-404 rejection is rethrown.
 */
export async function listMigrationContext(
  ctx: Pick<ResourceCtx, 'data' | 'platform'>,
  appIdentity: string,
  options: MigrationOptions = {},
): Promise<MigrationContext> {
  const {signal} = options
  signal?.throwIfAborted()

  const platform = withSignal(
    ctx.platform.withHeaders({'Accept-Inclusion': 'addon:plan,config_vars'}),
    signal,
  )
  const data = withSignal(ctx.data, signal)

  const attachments = await platform.addOnAttachment.listByApp(appIdentity) as AddOnAttachmentWithInclusions[]

  // Keep only Postgres databases this app *owns* (attachments to databases
  // owned by other apps are excluded), then dedupe to unique add-ons while
  // collecting the names each is attached under (insertion order preserved).
  const byAddonId = new Map<string, MigrationSource>()
  for (const attachment of attachments) {
    const {addon} = attachment
    if (!isPostgresAddon(addon) || (addon.app?.name !== appIdentity && addon.app?.id !== appIdentity)) continue

    const existing = byAddonId.get(addon.id)
    if (existing) {
      existing.attachmentNames.push(attachment.name)
    } else {
      byAddonId.set(addon.id, {...addon, attachmentNames: [attachment.name]})
    }
  }

  const databases = [...byAddonId.values()]
  const sources = databases.filter(db => isLegacyDatabase(db) && !isEssentialDatabase(db))
  const advanced = databases.filter(db => isAdvancedDatabase(db))

  const [migrationResults, infoResults] = await Promise.all([
    Promise.allSettled(advanced.map(db => data.postgresMigration.info(db.id))),
    Promise.allSettled(advanced.map(db => data.postgres.info(db.id))),
  ])

  // A 404 means the database isn't a migration target yet (or has no info) —
  // expected. Anything else is a real failure; rethrow the first one.
  const unexpected = [...migrationResults, ...infoResults].find((result): result is PromiseRejectedResult => result.status === 'rejected' && !(result.reason instanceof NotFoundError))
  if (unexpected) throw unexpected.reason

  const targets: MigrationTarget[] = advanced.map((db, index) => {
    const migrationResult = migrationResults[index]
    const infoResult = infoResults[index]
    return {
      ...db,
      info: infoResult.status === 'fulfilled' ? infoResult.value : undefined,
      migration: migrationResult.status === 'fulfilled' ? migrationResult.value : undefined,
    }
  })

  const migrations = targets
    .map(target => target.migration)
    .filter((migration): migration is Migration => migration !== undefined)

  return {migrations, sources, targets}
}

// These extension keys are intentionally named distinctly from the generated
// `postgresMigration` routes (`info`/`create`/`run`/`cancel`) they wrap.
// Registering an extension under a generated route's own name silently replaces
// that route (the replacement is only debug-logged), which both hides the
// orchestration behind a familiar-looking name and leaves no way to reach the
// raw route. Distinct names keep both surfaces available and make the
// gate-and-refetch helpers discoverable as such.
export const postgresMigrationExtensions = extendResource('data', 'postgresMigration', ctx => ({
  cancelMigration: (
    targetAddonId: string,
    options?: MigrationOptions,
  ) => cancel(ctx, targetAddonId, options),
  createMigration: (
    targetAddonId: string,
    body: MigrationCreateBody,
    options?: MigrationOptions,
  ) => create(ctx, targetAddonId, body, options),
  findMigration: (
    targetAddonId: string,
    options?: MigrationOptions,
  ) => info(ctx, targetAddonId, options),
  listMigrationContext: (
    appIdentity: string,
    options?: MigrationOptions,
  ) => listMigrationContext(ctx, appIdentity, options),
  runMigration: (
    targetAddonId: string,
    options?: MigrationOptions,
  ) => run(ctx, targetAddonId, options),
}))
