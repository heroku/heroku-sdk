/* eslint-disable no-await-in-loop */
import type {AddOn} from '@heroku/types/3.sdk'
import type {
  PostgresPoolCreateResult, PostgresRunUpgradeOpts, PostgresRunUpgradeResult, PostgresWaitStatusResult,
} from '@heroku/types/data'

import {NotFoundError} from '@heroku/heroku-fetch'

import type {ResourceCtx} from '../../core/extend-resource.js'
import type {ResolvedAddOn} from '../platform/add-on/types.js'
import type {ResolvedPgDatabase} from './internal/resolve-pg-database.js'

import {extendResource} from '../../core/extend-resource.js'
import {withSignal} from '../../core/with-signal.js'
import {wait} from '../../utils/wait.js'
import {createAndWait} from '../platform/add-on/create-and-wait.js'
import {resolveAddonInternal} from '../platform/add-on/resolve.js'
import {getPostgresServiceName, isAdvancedDatabase, NotAdvancedDatabaseError} from './internal/postgres-utils.js'
import {resolvePgDatabase} from './internal/resolve-pg-database.js'

const DEFAULT_WAIT_INTERVAL_MS = 5000

/**
 * Matches the CLI's historical 404 tolerance in `data:pg:wait`: the platform
 * briefly 404s a freshly-provisioned database's `wait_status` before its row
 * exists. We treat up to this many 404s as "still provisioning" (the budget is
 * never reset), then rethrow.
 */
const DEFAULT_WAIT_NOT_FOUND_RETRIES = 20

/**
 * Synthetic wait message surfaced to `onPoll` while the `wait_status` endpoint
 * is still 404ing during the initial provisioning window.
 */
const PROVISIONING_WAIT_MESSAGE = 'Waiting to provision...'

export type RunUpgradeOptions = {
  beforeRunUpgrade?: (preview: {addon: ResolvedPgDatabase; currentVersion: string}) => Promise<void> | void
  signal?: AbortSignal
}

export type RunUpgradeResult = {
  addon: ResolvedPgDatabase
  result: PostgresRunUpgradeResult
}

/**
 * Resolves a Postgres database by attachment identity and runs a version upgrade.
 *
 * Throws `NotAdvancedDatabaseError` (carrying the resolved add-on) if the
 * database isn't an Advanced-tier database. If provided, `beforeRunUpgrade`
 * runs after resolution/tier-checking (and the current-version lookup) but
 * before the upgrade request fires; an abort during the hook prevents the
 * upgrade.
 */
export async function runUpgrade(
  ctx: Pick<ResourceCtx, 'data' | 'platform'>,
  appIdentity: string,
  addonIdentity?: string,
  body: PostgresRunUpgradeOpts = {},
  options: RunUpgradeOptions = {},
): Promise<RunUpgradeResult> {
  const {beforeRunUpgrade, signal} = options
  signal?.throwIfAborted()

  const addon = await resolvePgDatabase(ctx, appIdentity, {input: addonIdentity, signal})

  if (!isAdvancedDatabase(addon)) {
    throw new NotAdvancedDatabaseError(addon, `You can only use postgres.runUpgrade() on Advanced-tier databases. ${addon.name} isn't an Advanced-tier database.`)
  }

  // Bind the signal so the info and upgrade requests abort in flight.
  const data = withSignal(ctx.data, signal)
  const {version: currentVersion} = await data.postgres.info(addon.id)

  await beforeRunUpgrade?.({addon, currentVersion})
  signal?.throwIfAborted()

  const result = await data.postgres.runUpgrade(addon.id, body)

  return {addon, result}
}

export type WaitForReadyOptions = {
  /**
   * How many consecutive 404s from `wait_status` to tolerate as "still
   * provisioning" before rethrowing. Defaults to 20; the budget is not reset
   * between polls.
   */
  notFoundRetries?: number
  /**
   * Fires once per poll with the latest status (including the synthetic
   * "still provisioning" status produced while the endpoint 404s), letting
   * callers surface a live progress message.
   */
  onPoll?: (status: PostgresWaitStatusResult) => void
  /**
   * Aborts the in-flight request and any pending poll delay.
   */
  signal?: AbortSignal
  /**
   * Maximum total time to wait before throwing. If omitted, polls until the
   * database reports ready or `signal` aborts.
   */
  timeoutMs?: number
  /**
   * Polling interval in milliseconds. Defaults to 5000 (5s), matching the
   * CLI's historical `--wait-interval` default. Named `waitIntervalMs` to match
   * the SDK-wide wait-tuning convention (`platform.addOn`, `platform.domain`,
   * `data.postgresDatabase`).
   */
  waitIntervalMs?: number
}

export type WaitForReadyResult = {
  addon: ResolvedPgDatabase
  result: PostgresWaitStatusResult
}

export type ProvisionAdvancedBody = {
  /** Attachment name (`--as`). */
  as?: string
  /**
   * Extra provision options (parsed CLI `--provision-option` pairs). Merged
   * last, so these override `level`/`version`/`high-availability`.
   */
  config?: Record<string, boolean | string | undefined>
  /** Confirmation value for a `confirmation_required` retry. */
  confirm?: string
  /** Number of follower pool instances to provision after the leader. */
  followers?: number
  /** Provision the leader with a high-availability standby. */
  highAvailability?: boolean
  /** Leader compute level (e.g. `advanced-0`). */
  level: string
  /** Add-on name (`--name`). */
  name?: string
  /** Private/Shield network variant; selects the `advanced[-private|-shield]` plan. */
  network?: 'private' | 'shield'
  /** Postgres version to provision. */
  version?: string
}

export type ForkBody = {
  /** Attachment name (`--as`). */
  as?: string
  /** Extra provision options (parsed CLI `--provision-option` pairs). Merged last. */
  config?: Record<string, boolean | string | undefined>
  /** Confirmation value for a `confirmation_required` retry. */
  confirm?: string
  /**
   * Leader compute level. When omitted, defaults to the source database's
   * current leader pool level.
   */
  level?: string
  /** Add-on name (`--name`). */
  name?: string
  /**
   * When set, provisions a point-in-time rollback instead of a live fork. A
   * `Date` is formatted to the platform's UTC `YYYY-MM-DDTHH:MM:SS`; a string
   * is passed through verbatim (matching the CLI's `--rollback-to`).
   */
  recoveryTime?: Date | string
}

export type ProvisionAdvancedOptions = Pick<
  WaitForReadyOptions,
  'notFoundRetries' | 'onPoll' | 'signal' | 'timeoutMs' | 'waitIntervalMs'
> & {
  /**
   * Fires once the leader add-on create request returns, before the wait
   * poll begins (only when `wait` is set), letting callers switch to a
   * "waiting for provisioning" display.
   */
  onProvisioning?: (addon: AddOn) => Promise<void> | void
  /** Poll `wait_status` until the leader is ready before returning. */
  wait?: boolean
}

export type ProvisionAdvancedResult = {
  /** The newly-created leader add-on. */
  addon: AddOn
  /** The follower pool, when `followers` was provided. */
  pool?: PostgresPoolCreateResult
  /** The terminal wait status, when `wait` was set. */
  waitStatus?: PostgresWaitStatusResult
}

export type ForkResult = {
  /** The newly-created fork/rollback add-on. */
  addon: AddOn
  /** The resolved source database the fork was created from. */
  source: ResolvedAddOn
  /** The terminal wait status, when `wait` was set. */
  waitStatus?: PostgresWaitStatusResult
}

/**
 * Polls `data.postgres.waitStatus` for an add-on id until it reports ready
 * (`waiting: false`), tolerating a bounded number of 404s during the initial
 * provisioning window (see `notFoundRetries`). Shared by `waitForReady`,
 * `provisionAdvanced`, and `fork`.
 *
 * The caller's `signal` is threaded into both the in-flight request (via
 * `withSignal`) and the poll-delay `wait()`, so aborting takes effect during
 * either phase.
 */
async function pollPostgresReady(
  ctx: Pick<ResourceCtx, 'data'>,
  addonId: string,
  options: Pick<WaitForReadyOptions, 'notFoundRetries' | 'onPoll' | 'signal' | 'timeoutMs' | 'waitIntervalMs'> = {},
): Promise<PostgresWaitStatusResult> {
  const {
    notFoundRetries = DEFAULT_WAIT_NOT_FOUND_RETRIES,
    onPoll,
    signal,
    timeoutMs,
    waitIntervalMs = DEFAULT_WAIT_INTERVAL_MS,
  } = options

  signal?.throwIfAborted()

  const data = withSignal(ctx.data, signal)
  const deadline = timeoutMs === undefined ? undefined : Date.now() + timeoutMs
  let remainingNotFound = notFoundRetries

  while (true) {
    signal?.throwIfAborted()

    let status: PostgresWaitStatusResult
    try {
      status = await data.postgres.waitStatus(addonId)
    } catch (error) {
      // The platform briefly 404s a freshly-provisioned database before its
      // row exists; absorb a bounded number of those as "still provisioning".
      if (!(error instanceof NotFoundError) || remainingNotFound <= 0) throw error
      remainingNotFound--
      status = {message: PROVISIONING_WAIT_MESSAGE, waiting: true}
    }

    onPoll?.(status)

    if (!status.waiting) return status

    if (deadline !== undefined && Date.now() >= deadline) {
      throw new Error(`Postgres database '${addonId}' did not become ready within ${timeoutMs}ms`)
    }

    await wait(waitIntervalMs, signal)
  }
}

/**
 * Resolves a Postgres database by attachment identity and polls its
 * `wait_status` until it reports ready. `waiting: true` covers any in-progress
 * operation (provisioning, migration, or update), not just initial provision.
 *
 * Throws `NotAdvancedDatabaseError` (carrying the resolved add-on) if the
 * database isn't an Advanced-tier database.
 */
export async function waitForReady(
  ctx: Pick<ResourceCtx, 'data' | 'platform'>,
  appIdentity: string,
  addonIdentity?: string,
  options: WaitForReadyOptions = {},
): Promise<WaitForReadyResult> {
  const {signal} = options
  signal?.throwIfAborted()

  const addon = await resolvePgDatabase(ctx, appIdentity, {input: addonIdentity, signal})

  if (!isAdvancedDatabase(addon)) {
    throw new NotAdvancedDatabaseError(addon, `You can only use postgres.waitForReady() on Advanced-tier databases. ${addon.name} isn't an Advanced-tier database.`)
  }

  const result = await pollPostgresReady(ctx, addon.id, options)

  return {addon, result}
}

/**
 * Builds a provision config body, dropping `undefined` values (the platform
 * treats an absent key as unset) and letting `extra` options override the
 * well-known keys. Booleans are preserved and serialized as-is.
 */
function buildProvisionConfig(
  base: Record<string, boolean | string | undefined>,
  extra: Record<string, boolean | string | undefined> = {},
): Record<string, string> {
  const config: Record<string, boolean | string> = {}
  for (const [key, value] of Object.entries({...base, ...extra})) {
    if (value !== undefined) config[key] = value
  }

  // The platform accepts booleans here (e.g. `high-availability`), but the
  // typed `AddOnCreateOpts.config` is `Record<string, string>`; cast through,
  // matching the CLI's own `createAddon` helper.
  return config as Record<string, string>
}

/**
 * Provisions a new Advanced-tier Postgres leader (and, when `followers` is
 * given, a follower pool), replacing the CLI's `createAddon` + `createPool`
 * sequence.
 *
 * A `confirmation_required` response surfaces as `AddonConfirmationRequiredError`
 * — catch it, gather a confirmation value, and retry with `body.confirm` set
 * (the CLI retries with `confirm = app`). When `wait` is set, polls the data
 * `wait_status` endpoint (not the platform add-on state) until the leader is
 * ready; the follower pool is then created against the ready leader, matching
 * the CLI's ordering.
 */
export async function provisionAdvanced(
  ctx: Pick<ResourceCtx, 'data' | 'platform'>,
  appIdentity: string,
  body: ProvisionAdvancedBody,
  options: ProvisionAdvancedOptions = {},
): Promise<ProvisionAdvancedResult> {
  const {notFoundRetries, onPoll, onProvisioning, signal, timeoutMs, wait: shouldWait, waitIntervalMs} = options
  signal?.throwIfAborted()

  const {as, config: extra, confirm, followers, highAvailability, level, name, network, version} = body

  const plan = `${getPostgresServiceName()}:advanced${network ? `-${network}` : ''}`
  const config = buildProvisionConfig({'high-availability': highAvailability, level, version}, extra)

  const addon = await createAndWait(
    ctx,
    appIdentity,
    {
      attachment: {name: as}, config, confirm, name, plan,
    },
    {signal},
  )

  let waitStatus: PostgresWaitStatusResult | undefined
  if (shouldWait) {
    await onProvisioning?.(addon)
    signal?.throwIfAborted()
    waitStatus = await pollPostgresReady(ctx, addon.id!, {
      notFoundRetries, onPoll, signal, timeoutMs, waitIntervalMs,
    })
  }

  let pool: PostgresPoolCreateResult | undefined
  if (followers && followers > 0) {
    pool = await withSignal(ctx.data, signal).postgresPool.create(addon.id!, {count: followers, level})
  }

  return {addon, pool, waitStatus}
}

/**
 * Formats a rollback recovery time to the platform's UTC `YYYY-MM-DDTHH:MM:SS`
 * (no `Z`, no milliseconds). A string is passed through unchanged.
 */
const pad2 = (n: number) => String(n).padStart(2, '0')

function formatRecoveryTime(value: Date | string): string {
  if (typeof value === 'string') return value

  return `${value.getUTCFullYear()}-${pad2(value.getUTCMonth() + 1)}-${pad2(value.getUTCDate())}T${pad2(value.getUTCHours())}:${pad2(value.getUTCMinutes())}:${pad2(value.getUTCSeconds())}`
}

/**
 * Forks (or, when `recoveryTime` is set, rolls back) an existing Advanced-tier
 * Postgres database into a new add-on on `appIdentity`.
 *
 * `sourceIdentity` is both resolved (to tier-check, default the level, and
 * pick the plan) and passed verbatim into the `fork`/`rollback` config value,
 * matching the CLI, which forks against the raw user-supplied identity. The
 * new add-on inherits the source's plan.
 *
 * Throws `NotAdvancedDatabaseError` (carrying the resolved source) if the
 * source isn't an Advanced-tier database. Confirmation and wait semantics
 * match `provisionAdvanced`.
 */
export async function fork(
  ctx: Pick<ResourceCtx, 'data' | 'platform'>,
  appIdentity: string,
  sourceIdentity: string,
  body: ForkBody = {},
  options: ProvisionAdvancedOptions = {},
): Promise<ForkResult> {
  const {notFoundRetries, onPoll, onProvisioning, signal, timeoutMs, wait: shouldWait, waitIntervalMs} = options
  signal?.throwIfAborted()

  const {as, config: extra, confirm, name, recoveryTime} = body

  const platform = withSignal(ctx.platform, signal)
  const source = await resolveAddonInternal(platform, sourceIdentity, {addonService: getPostgresServiceName(), appIdentity})

  if (!isAdvancedDatabase(source)) {
    throw new NotAdvancedDatabaseError(source, `You can only fork Advanced-tier databases with postgres.fork(). ${source.name} isn't an Advanced-tier database.`)
  }

  let {level} = body
  if (level === undefined) {
    const info = await withSignal(ctx.data, signal).postgres.info(source.id)
    level = info.pools.find(pool => pool.name === 'leader')?.expected_level
  }

  const config = recoveryTime === undefined
    ? buildProvisionConfig({fork: sourceIdentity, level}, extra)
    : buildProvisionConfig({level, 'recovery-time': formatRecoveryTime(recoveryTime), rollback: sourceIdentity}, extra)

  const addon = await createAndWait(
    ctx,
    appIdentity,
    {
      attachment: {name: as}, config, confirm, name, plan: source.plan!.name!,
    },
    {signal},
  )

  let waitStatus: PostgresWaitStatusResult | undefined
  if (shouldWait) {
    await onProvisioning?.(addon)
    signal?.throwIfAborted()
    waitStatus = await pollPostgresReady(ctx, addon.id!, {
      notFoundRetries, onPoll, signal, timeoutMs, waitIntervalMs,
    })
  }

  return {addon, source, waitStatus}
}

export const postgresExtensions = extendResource('data', 'postgres', ctx => ({
  fork: (
    appIdentity: string,
    sourceIdentity: string,
    body?: ForkBody,
    options?: ProvisionAdvancedOptions,
  ) => fork(ctx, appIdentity, sourceIdentity, body, options),
  provisionAdvanced: (
    appIdentity: string,
    body: ProvisionAdvancedBody,
    options?: ProvisionAdvancedOptions,
  ) => provisionAdvanced(ctx, appIdentity, body, options),
  runUpgrade: (
    appIdentity: string,
    addonIdentity?: string,
    body?: PostgresRunUpgradeOpts,
    options?: RunUpgradeOptions,
  ) => runUpgrade(ctx, appIdentity, addonIdentity, body, options),
  waitForReady: (
    appIdentity: string,
    addonIdentity?: string,
    options?: WaitForReadyOptions,
  ) => waitForReady(ctx, appIdentity, addonIdentity, options),
}))
