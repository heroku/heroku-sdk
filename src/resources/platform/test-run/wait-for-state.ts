/* eslint-disable no-await-in-loop */
import type {TestRun} from '@heroku/types/3.sdk'

import type {ResourceCtx} from '../../../core/extend-resource.js'

import {wait} from '../../../utils/wait.js'

/**
 * The documented `TestRun.status` values from the Platform API. Provided
 * for autocomplete in {@link waitForState}'s `targetStates`; the runtime
 * comparison is plain string membership (`targetStates.includes(run.status)`),
 * so any string is accepted.
 */
export type TestRunStatus = TestRun['status']

const DEFAULT_INTERVAL_MS = 1000
// Finite default so a stuck CI test run can't hang a caller forever.
// Diverges deliberately from `promotePipeline`, which leaves `timeoutMs`
// unbounded; callers that need longer can pass an explicit `timeoutMs`.
const DEFAULT_TIMEOUT_MS = 600_000

/**
 * Thrown by {@link waitForState} when the test run did not reach one of
 * `targetStates` within `timeoutMs`. Carries the last observed run so
 * callers can branch on its terminal `status` (e.g. distinguish a
 * `failed` run from one still `building`). Mirrors `DynoNotReadyError`.
 */
export class TestRunNotReadyError extends Error {
  public readonly id = 'test_run_not_ready'

  constructor(
    public readonly testRun: TestRun,
    public readonly expectedStates: ReadonlyArray<string>,
    public readonly timeoutMs: number,
  ) {
    super(`Test run #${testRun.number} did not reach status ${expectedStates.join('/')} `
      + `within ${timeoutMs}ms (last status: ${testRun.status}).`)
    this.name = 'TestRunNotReadyError'
  }
}

export type WaitForStateOptions = {
  /**
   * Delay between polls in milliseconds. Defaults to 1000.
   */
  intervalMs?: number
  /**
   * Fires after every successful `testRun.infoByPipeline` call, including
   * runs whose `status` does not yet match `targetStates` (and trigger
   * another poll) AND the final matching run before it is returned. Use
   * this to surface live state transitions in a UI. Exceptions thrown from
   * this callback propagate and end the wait — there is no implicit catch.
   */
  onPoll?: (run: TestRun) => void
  /**
   * Cancels the wait early. If already aborted, {@link waitForState}
   * rejects before the first poll; if aborted mid-wait, the pending delay
   * rejects with `signal.reason`.
   */
  signal?: AbortSignal
  /**
   * Wall-clock budget in milliseconds before {@link TestRunNotReadyError}
   * is thrown. Defaults to 600000 (10 minutes) — a finite default so a
   * stuck run can't hang forever. Pass a larger value for long CI runs.
   */
  timeoutMs?: number
}

/**
 * Poll `testRun.infoByPipeline` until the run's `status` is one of
 * `targetStates`, then return that run. Reuses the SDK's cancellable
 * `wait()` helper to space polls — no bare `setTimeout` loop.
 *
 * Transient-error handling: errors from `infoByPipeline` **propagate**;
 * there is no 404/429/503 retry. This matches the closest precedent,
 * `promotePipeline`, and the original CLI `waitForStates`, which had no
 * retry either — adopting `waitForInfo`'s transient retry would be behavior
 * the eventual CLI caller never had.
 *
 * On exceeding `timeoutMs` without a match, throws {@link TestRunNotReadyError}
 * carrying the last observed run.
 *
 * @example
 * ```ts
 * const run = await platform.testRun.waitForState(pipelineId, 42, ['debugging', 'errored'])
 * ```
 */
export async function waitForState(
  ctx: Pick<ResourceCtx, 'platform'>,
  pipelineId: string,
  testRunNumber: number,
  targetStates: ReadonlyArray<string | TestRunStatus>,
  options: WaitForStateOptions = {},
): Promise<TestRun> {
  const {
    intervalMs = DEFAULT_INTERVAL_MS,
    onPoll,
    signal,
    timeoutMs = DEFAULT_TIMEOUT_MS,
  } = options

  signal?.throwIfAborted()

  // Scope the in-flight info call to the caller's signal so an abort takes
  // effect during the API call, not just during the backoff.
  const platform = signal ? ctx.platform.withOptions({signal}) : ctx.platform

  const deadline = Date.now() + timeoutMs

  while (true) {
    signal?.throwIfAborted()

    const run = await platform.testRun.infoByPipeline(pipelineId, testRunNumber)
    onPoll?.(run)
    if (targetStates.includes(run.status)) {
      return run
    }

    if (Date.now() >= deadline) {
      throw new TestRunNotReadyError(run, targetStates, timeoutMs)
    }

    await wait(intervalMs, signal)
  }
}
