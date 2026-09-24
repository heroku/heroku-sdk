/* eslint-disable no-await-in-loop */
import type {TransferInfoByAppResult} from '@heroku/types/data'

import type {ResourceCtx} from '../../core/extend-resource.js'

import {extendResource} from '../../core/extend-resource.js'
import {wait} from '../../utils/wait.js'

const DEFAULT_INTERVAL_MS = 3000
const MAX_FAILURES = 20

/**
 * Thrown by `waitForTransfer` when the transfer reaches a terminal state
 * with `succeeded: false`.
 */
export class TransferFailedError extends Error {
  public readonly id = 'transfer_failed'

  constructor(public readonly transfer: TransferInfoByAppResult) {
    super('An error occurred and the backup did not finish.')
    this.name = 'TransferFailedError'
  }

  public get body() {
    return {id: this.id, message: this.message}
  }
}

/**
 * Thrown by `waitForTransfer` when `timeoutMs` elapses before the
 * transfer reaches a terminal state.
 */
export class TransferTimeoutError extends Error {
  public readonly id = 'transfer_timeout'

  constructor(public readonly transferId: string, public readonly timeoutMs: number) {
    super(`Transfer '${transferId}' did not finish within ${timeoutMs}ms`)
    this.name = 'TransferTimeoutError'
  }

  public get body() {
    return {id: this.id, message: this.message}
  }
}

export type WaitForTransferOptions = {
  /**
   * Polling interval in milliseconds. Defaults to 3000 (3s)
   */
  intervalMs?: number
  /**
   * Fired after every wait poll with the latest transfer record,
   * letting callers drive a status display.
   */
  onPoll?: (transfer: TransferInfoByAppResult) => void
  /**
   * Abort signal to cancel the operation.
   */
  signal?: AbortSignal
  /**
   * Maximum total time to wait before throwing `TransferTimeoutError`.
   * If omitted, polls until the transfer finishes or `signal` aborts.
   */
  timeoutMs?: number
  /**
   * Fetch full log lines when `true`.
   */
  verbose?: boolean
}

/**
 * Poll `data.transfer.infoByApp` until the transfer reaches a terminal
 * state (`finished_at` set).
 *
 * Throws `TransferFailedError` if the transfer fails or `TransferTimeoutError`
 * if the transfer does not finish before timeout.
 */
export async function waitForTransfer(
  ctx: Pick<ResourceCtx, 'data'>,
  appIdentity: string,
  transferId: string,
  options: WaitForTransferOptions = {},
): Promise<TransferInfoByAppResult> {
  const {
    intervalMs = DEFAULT_INTERVAL_MS,
    onPoll,
    signal,
    timeoutMs,
    verbose,
  } = options

  signal?.throwIfAborted()

  const data = signal ? ctx.data.withOptions({signal}) : ctx.data

  const deadline = timeoutMs === undefined ? undefined : Date.now() + timeoutMs
  let failures = 0
  let transfer = {} as TransferInfoByAppResult

  while (true) {
    signal?.throwIfAborted()

    try {
      transfer = await data.transfer.infoByApp(appIdentity, transferId, {verbose})
    } catch (error) {
      failures++
      if (failures > MAX_FAILURES) {
        throw error
      }
    }

    onPoll?.(transfer)

    if (transfer.finished_at) {
      if (transfer.succeeded) {
        return transfer
      }

      const verboseTransfer = verbose ? transfer : await data.transfer.infoByApp(appIdentity, transferId, {verbose: true})
      throw new TransferFailedError(verboseTransfer)
    }

    if (deadline !== undefined && Date.now() >= deadline) {
      throw new TransferTimeoutError(transferId, timeoutMs!)
    }

    await wait(intervalMs, signal)
  }
}

export const transferExtensions = extendResource('data', 'transfer', ctx => ({
  waitForTransfer: (appIdentity: string, transferId: string, options?: WaitForTransferOptions) =>
    waitForTransfer(ctx, appIdentity, transferId, options),
}))
