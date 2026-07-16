/* eslint-disable no-await-in-loop */
import type {Domain} from '@heroku/types/3.sdk'

import type {ResourceCtx} from '../../../core/extend-resource.js'

import {wait} from '../../../utils/wait.js'

const DEFAULT_WAIT_INTERVAL_MS = 15_000

export type WaitForACMCertificatesOptions = {
  /**
   * Abort signal to cancel the operation.
   */
  signal?: AbortSignal

  /**
   * Maximum time in milliseconds to wait before giving up.
   * If undefined, waits indefinitely (preserving the CLI's
   * poll-forever behavior) until the signal aborts.
   */
  timeoutMs?: number

  /**
   * Base polling interval in milliseconds. Defaults to 15000 (the
   * CLI's 15s base). The effective delay grows with the CLI's backoff
   * formula, scaled off this value.
   */
  waitIntervalMs?: number
}

/**
 * Waits for ACM (Automated Certificate Management) certificates to be
 * issued on all custom domains of an app.
 *
 * Polls the app's domains until every `custom` domain reaches a
 * terminal `acm_status` of `'cert issued'` or `'failed'`, then returns
 * the custom domains. `heroku` domains are ignored and never block
 * termination.
 *
 * @throws if any custom domain finishes with `acm_status: 'failed'`
 * (`'ACM not enabled for some domains'`), or if `timeoutMs` elapses
 * before all custom domains reach a terminal status.
 */
export async function waitForACMCertificates(
  ctx: Pick<ResourceCtx, 'platform'>,
  appIdentity: string,
  options: WaitForACMCertificatesOptions = {},
): Promise<Domain[]> {
  const {signal, timeoutMs, waitIntervalMs = DEFAULT_WAIT_INTERVAL_MS} = options

  signal?.throwIfAborted()

  const platform = signal ? ctx.platform.withOptions({signal}) : ctx.platform

  function terminal(domains: Domain[]): boolean {
    return domains
      .filter(domain => domain.kind === 'custom')
      .every(domain => domain.acm_status === 'cert issued' || domain.acm_status === 'failed')
  }

  function someFailed(domains: Domain[]): boolean {
    return domains
      .filter(domain => domain.kind === 'custom')
      .some(domain => domain.acm_status === 'failed')
  }

  function backoff(attempts: number): number {
    const multiplier = attempts < 60 ? Math.floor(attempts / 20) : 3
    return waitIntervalMs * (1 + multiplier)
  }

  let domains = await platform.domain.list(appIdentity)

  if (!terminal(domains)) {
    const deadline = timeoutMs === undefined ? undefined : Date.now() + timeoutMs
    let retries = 0
    while (!terminal(domains)) {
      await wait(backoff(retries), signal)

      if (deadline !== undefined && Date.now() >= deadline) {
        throw new Error(`Timed out waiting for ACM certificates on app ${appIdentity}`)
      }

      domains = await platform.domain.list(appIdentity)
      retries++
    }
  }

  if (someFailed(domains)) {
    throw new Error('ACM not enabled for some domains')
  }

  return domains.filter(domain => domain.kind === 'custom')
}
