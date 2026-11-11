/* eslint-disable no-await-in-loop */
import type {DatabaseWaitStatusResult} from '@heroku/types/data'

import {NotFoundError} from '@heroku/heroku-fetch'
import createDebug from 'debug'

import type {ResourceCtx} from '../../core/extend-resource.js'
import type {ResolvedPgDatabase} from './internal/resolve-pg-database.js'
import type {LegacyDatabase} from './postgres-database/index.js'

import {extendResource} from '../../core/extend-resource.js'
import {combineSignals, withSignal} from '../../core/with-signal.js'
import {waitForDuration} from '../../utils/request-with-timeout.js'
import {resolvePgDatabase} from './internal/resolve-pg-database.js'
import {listLegacyByApp} from './postgres-database/index.js'

const debug = createDebug('heroku:sdk:resources:database')

const DEFAULT_WAIT_INTERVAL_MS = 5000
const DEFAULT_NOT_FOUND_RETRIES = 20
const PROVISIONING_WAIT_MESSAGE = 'Waiting to provision...'

/** Classic `/client/v11` wait status, including its terminal error indicator. */
export type LegacyDatabaseWaitStatus = DatabaseWaitStatusResult & {
  'error?'?: boolean
}

export type WaitForLegacyDatabaseReadyOptions = {
  /** Fires after each poll, including synthetic statuses for tolerated 404s. */
  onPoll?: (event: {addon: ResolvedPgDatabase; status: LegacyDatabaseWaitStatus}) => void
  /** Aborts the in-flight request and any pending poll delay. */
  signal?: AbortSignal
  /** Polling interval in milliseconds. Defaults to 5000 (5s). */
  waitIntervalMs?: number
}

export type LegacyDatabaseWaitResult = {
  addon: ResolvedPgDatabase
  status: LegacyDatabaseWaitStatus
}

export type WaitForLegacyDatabaseReadyResult = {
  /** Results preserve input/list order; the app-wide form waits sequentially. */
  databases: LegacyDatabaseWaitResult[]
}

/** Raised when classic Postgres reports an `error?` wait status. */
export class LegacyDatabaseWaitError extends Error {
  constructor(
    public readonly addon: ResolvedPgDatabase,
    public readonly status: LegacyDatabaseWaitStatus,
  ) {
    super(status.message)
    this.name = 'LegacyDatabaseWaitError'
  }
}

/**
 * Polls the classic Postgres `/client/v11` wait-status endpoint. With an
 * identity, only that database is resolved and waited on; without one, all
 * legacy databases visible to the app are waited on sequentially.
 *
 * This intentionally has no timeout: classic `pg:wait` waits until ready or
 * aborted. The default 404 retry budget and interval match the CLI behavior.
 */
export async function waitForLegacyDatabaseReady(
  ctx: Pick<ResourceCtx, 'data' | 'operationSignal' | 'platform'>,
  appIdentity: string,
  addonIdentity?: string,
  options: WaitForLegacyDatabaseReadyOptions = {},
): Promise<WaitForLegacyDatabaseReadyResult> {
  const {onPoll, signal} = options
  const operationSignal = combineSignals(ctx.operationSignal, signal)
  const waitIntervalMs = normalizeWaitInterval(options.waitIntervalMs)
  operationSignal?.throwIfAborted()

  const databases: Array<LegacyDatabase | ResolvedPgDatabase> = addonIdentity === undefined
    ? await listLegacyByApp(ctx, appIdentity, {signal: operationSignal})
    : [await resolvePgDatabase(ctx, appIdentity, {input: addonIdentity, signal: operationSignal})]

  const results: LegacyDatabaseWaitResult[] = []
  const data = withSignal(ctx.data, operationSignal)

  for (const addon of databases) {
    const status = await waitForDatabase(data, addon, {onPoll, signal: operationSignal, waitIntervalMs})
    results.push({addon, status})
  }

  return {databases: results}
}

async function waitForDatabase(
  data: ResourceCtx['data'],
  addon: ResolvedPgDatabase,
  options: Pick<WaitForLegacyDatabaseReadyOptions, 'onPoll' | 'signal'> & {waitIntervalMs: number},
): Promise<LegacyDatabaseWaitStatus> {
  const {onPoll, signal, waitIntervalMs} = options
  let remainingNotFound = DEFAULT_NOT_FOUND_RETRIES

  debug('waitForReady database=%s intervalMs=%d', addon.name, waitIntervalMs)

  while (true) {
    signal?.throwIfAborted()

    let status: LegacyDatabaseWaitStatus
    try {
      status = await data.database.waitStatus(addon.id)
    } catch (error) {
      if (!(error instanceof NotFoundError) || remainingNotFound <= 0) throw error
      remainingNotFound--
      status = {message: PROVISIONING_WAIT_MESSAGE, 'waiting?': true}
      debug('waitForReady database=%s 404 during provisioning window (%d retries left)', addon.name, remainingNotFound)
    }

    onPoll?.({addon, status})

    if (status['error?']) {
      throw new LegacyDatabaseWaitError(addon, status)
    }

    if (!status['waiting?']) {
      debug('waitForReady database=%s ready', addon.name)
      return status
    }

    await waitForDuration(waitIntervalMs, signal)
  }
}

function normalizeWaitInterval(waitIntervalMs?: number): number {
  return waitIntervalMs !== undefined && Number.isFinite(waitIntervalMs) && waitIntervalMs > 0
    ? waitIntervalMs
    : DEFAULT_WAIT_INTERVAL_MS
}

export const legacyDatabaseWaitExtensions = extendResource('data', 'database', ctx => ({
  waitForReady: (
    appIdentity: string,
    addonIdentity?: string,
    options?: WaitForLegacyDatabaseReadyOptions,
  ) => waitForLegacyDatabaseReady(ctx, appIdentity, addonIdentity, options),
}))
