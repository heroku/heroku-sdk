/* eslint-disable no-await-in-loop */
import type {TransferInfoByAppResult} from '@heroku/types/data'

import type {ResourceCtx} from '../../../core/extend-resource.js'

import {extendResource} from '../../../core/extend-resource.js'
import {combineSignals, withSignal} from '../../../core/with-signal.js'
import {isAbortError} from '../../../utils/is-abort-error.js'
import {requestWithTimeout, waitForDuration} from '../../../utils/request-with-timeout.js'

const DEFAULT_INTERVAL_MS = 3000
const MAX_FAILURES = 20
const POLL_TIMED_OUT = Symbol('poll_timed_out')

/**
 * Thrown by `waitForTransfer` when the transfer reaches a terminal state
 * with `succeeded: false`.
 */
export class TransferFailedError extends Error {
  public ancillaryErrors?: string[]
  public readonly id = 'transfer_failed'
  public readonly transferId: string

  constructor(public readonly transfer: TransferInfoByAppResult) {
    super('An error occurred and the transfer did not finish.')
    this.name = 'TransferFailedError'
    this.transferId = transfer.uuid
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
  public ancillaryErrors?: string[]
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
  onPoll?: (transfer: TransferInfoByAppResult | undefined) => void
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

async function pollTransfer(options: {
  appIdentity: string
  ctx: Pick<ResourceCtx, 'data' | 'operationSignal'>
  deadline?: number
  signal?: AbortSignal
  transferId: string
  verbose: boolean | undefined
}): Promise<TransferInfoByAppResult | typeof POLL_TIMED_OUT> {
  const {
    appIdentity, ctx, deadline, signal, transferId, verbose,
  } = options
  const operationSignal = combineSignals(ctx.operationSignal, signal)
  return requestWithTimeout(
    requestSignal => withSignal(ctx.data, combineSignals(operationSignal, requestSignal))
      .transfer.infoByApp(appIdentity, transferId, {verbose}),
    {
      signal: operationSignal,
      timeoutMs: deadline === undefined ? undefined : deadline - Date.now(),
      timeoutValue: POLL_TIMED_OUT,
    },
  )
}

/**
 * Poll `data.transfer.infoByApp` until the transfer reaches a terminal
 * state (`finished_at` set).
 *
 * Throws `TransferFailedError` if the transfer fails or `TransferTimeoutError`
 * if the transfer does not finish before timeout.
 */
/* eslint-disable complexity */
export async function waitForTransfer(
  ctx: Pick<ResourceCtx, 'data' | 'operationSignal'>,
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
  const operationSignal = combineSignals(ctx.operationSignal, signal)

  operationSignal?.throwIfAborted()

  const deadline = timeoutMs === undefined ? undefined : Date.now() + timeoutMs
  let failures = 0
  let transfer: TransferInfoByAppResult | undefined

  const makeTimeoutError = () => new TransferTimeoutError(transferId, timeoutMs!)

  const poll = (deadlineValue = deadline, pollVerbose = verbose) => pollTransfer({
    appIdentity, ctx, deadline: deadlineValue, signal: operationSignal, transferId, verbose: pollVerbose,
  })

  while (true) {
    operationSignal?.throwIfAborted()

    if (deadline !== undefined && Date.now() >= deadline) {
      throw makeTimeoutError()
    }

    try {
      const result = await poll()

      if (result === POLL_TIMED_OUT) {
        throw makeTimeoutError()
      }

      transfer = result
    } catch (error) {
      // Never retry a cancellation: a client- or caller-level abort must stop
      // the poll immediately rather than burn up to MAX_FAILURES attempts.
      if (error instanceof TransferTimeoutError || operationSignal?.aborted || isAbortError(error)) {
        throw error
      }

      if (deadline !== undefined && Date.now() >= deadline) {
        throw makeTimeoutError()
      }

      failures++
      if (failures > MAX_FAILURES) {
        throw error
      }
    }

    onPoll?.(transfer)

    if (transfer?.finished_at) {
      if (transfer.succeeded) {
        return transfer
      }

      const verboseTransfer = verbose
        ? transfer
        : await fetchVerboseTransfer()

      if (verboseTransfer === POLL_TIMED_OUT) {
        throw makeTimeoutError()
      }

      throw new TransferFailedError(verboseTransfer)
    }

    if (deadline !== undefined && Date.now() >= deadline) {
      throw makeTimeoutError()
    }

    await waitForDuration(deadline === undefined ? intervalMs : Math.min(intervalMs, deadline - Date.now()), operationSignal)
  }

  async function fetchVerboseTransfer() {
    return poll(deadline, true)
  }
}
/* eslint-enable complexity */

export const transferExtensions = extendResource('data', 'transfer', ctx => ({
  waitForTransfer: (appIdentity: string, transferId: string, options?: WaitForTransferOptions) =>
    waitForTransfer(ctx, appIdentity, transferId, options),
}))
