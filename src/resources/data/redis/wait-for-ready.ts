/* eslint-disable no-await-in-loop */
import type {RedisWaitResult} from '@heroku/types/data'

import {NotFoundError} from '@heroku/heroku-fetch'
import createDebug from 'debug'

import type {ResourceCtx} from '../../../core/extend-resource.js'

import {wait} from '../../../utils/wait.js'

const debug = createDebug('heroku:sdk:resources:redis')

const DEFAULT_INTERVAL_MS = 5000

export type WaitForRedisReadyOptions = {
  /**
   * Polling interval in milliseconds. Defaults to 5000 (5s), matching
   * the CLI's historical `--wait-interval` default.
   */
  intervalMs?: number
  /**
   * Aborts the in-flight request and any pending poll delay.
   */
  signal?: AbortSignal
  /**
   * Maximum total time to wait before throwing. If omitted, polls until
   * the database reports ready or `signal` aborts.
   */
  timeoutMs?: number
}

/**
 * Poll `data.redis.wait` until the redis database reports ready
 * (`waiting?: false`).
 *
 * A 404 from the wait endpoint during the initial provisioning window
 * is treated as "still waiting" — the platform briefly returns 404 for
 * a database whose row has not yet been created after the addon
 * provision call resolves.
 *
 * Cancellation: the caller's `signal` is threaded into both the
 * in-flight request (via `withOptions`) and the poll-delay `wait()`,
 * so aborting takes effect during either phase.
 */
export async function waitForRedisReady(
  ctx: Pick<ResourceCtx, 'data'>,
  nameOrId: string,
  options: WaitForRedisReadyOptions = {},
): Promise<RedisWaitResult> {
  const {intervalMs = DEFAULT_INTERVAL_MS, signal, timeoutMs} = options

  signal?.throwIfAborted()

  const data = signal ? ctx.data.withOptions({signal}) : ctx.data

  const deadline = timeoutMs === undefined ? undefined : Date.now() + timeoutMs

  debug('waitForReady name=%s intervalMs=%d timeoutMs=%s', nameOrId, intervalMs, timeoutMs ?? '<none>')

  while (true) {
    signal?.throwIfAborted()

    let status: RedisWaitResult
    try {
      status = await data.redis.wait(nameOrId)
    } catch (error) {
      if (!(error instanceof NotFoundError)) throw error
      debug('waitForReady name=%s 404 during provisioning window', nameOrId)
      status = {message: 'not found', 'waiting?': true}
    }

    if (!status['waiting?']) {
      debug('waitForReady name=%s ready', nameOrId)
      return status
    }

    if (deadline !== undefined && Date.now() >= deadline) {
      throw new Error(`Redis database '${nameOrId}' did not become ready within ${timeoutMs}ms`)
    }

    await wait(intervalMs, signal)
  }
}
