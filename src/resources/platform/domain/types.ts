import type {Domain, SniEndpoint} from '@heroku/types/3.sdk'

import type {Poller} from '../../../utils/poller.js'

export type DomainOptions = {
  /**
   * Abort signal to cancel the operation.
   */
  signal?: AbortSignal
}

export type WaitForReadyOptions = DomainOptions & {
  /**
   * Domain to wait for.
   */
  domain?: Domain

  /**
   * Hostname of the domain to wait for.
   */
  hostname?: string

  /**
   * Progress hooks fired once per domain being waited for:
   * `poller.onStart(domain)` before polling begins, `poller.onStop(domain)`
   * after the domain becomes ready.
   */
  poller?: Poller<Domain>

  /**
   * Maximum time in milliseconds to wait before giving up.
   * If undefined, waits indefinitely (until signal aborted).
   */
  timeoutMs?: number

  /**
   * Polling interval in milliseconds. Defaults to 5000.
   */
  waitIntervalMs?: number
}

export type CreateAndWaitOptions = DomainOptions & {
  /**
   * Progress hooks fired once per domain being waited for:
   * `poller.onStart(domain)` before polling begins, `poller.onStop(domain)`
   * after the domain becomes ready.
   */
  poller?: Poller<Domain>

  /**
   * Callback to resolve which SNI endpoint to use
   * when one is not provided.
   *
   * @param candidates List of SNI endpoints to choose from
   * @returns Promise resolving to the selected SNI endpoint
   */
  resolveSniEndpoint?: (
    candidates: SniEndpoint[],
  ) => Promise<string> | string

  /**
   * SNI endpoint to use.
   *
   * If provided, skips SNI endpoint listing and resolution.
   */
  sniEndpoint?: string

  /**
   * Maximum time in milliseconds to wait when `wait` is true.
   * Passed through to `waitForReady`.
   */
  timeoutMs?: number

  /**
   * If true, waits for the domain to reach ready status after creation.
   *
   * Defaults to false (return immediately after create).
   */
  wait?: boolean

  /**
   * Polling interval in milliseconds used when `wait` is true.
   * Passed through to `waitForReady`.
   */
  waitIntervalMs?: number
}
