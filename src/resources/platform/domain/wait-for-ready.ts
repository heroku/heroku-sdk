/* eslint-disable no-await-in-loop */
import type {Domain} from '@heroku/types/3.sdk'

import type {ResourceCtx} from '../../../core/extend-resource.js'
import type {WaitForReadyOptions} from './types.js'

import {wait} from '../../../utils/wait.js'

const DEFAULT_WAIT_INTERVAL_MS = 5000

/**
 * Waits for all pending domains on an app
 * to reach ready status ('succeeded' or 'none').
 *
 * If `domain` or `hostname` is provided, waits for the specific domain.
 *
 * @throws if the domain reaches a non-ready status (e.g., 'failed').
 */
export async function waitForReady(
  ctx: Pick<ResourceCtx, 'platform'>,
  appIdentity: string,
  options: WaitForReadyOptions = {},
): Promise<Domain[]> {
  const {
    domain,
    hostname,
    poller,
    signal,
    timeoutMs,
    waitIntervalMs = DEFAULT_WAIT_INTERVAL_MS,
  } = options

  signal?.throwIfAborted()

  const platform = signal ? ctx.platform.withOptions({signal}) : ctx.platform

  let domains
  if (domain) {
    domains = [domain]
  } else if (hostname) {
    const domain = await platform.domain.info(appIdentity, hostname)
    domains = [domain]
  } else {
    const apiDomains = await platform.domain.list(appIdentity)
    domains = apiDomains.filter(domain => domain.status === 'pending')
  }

  const readyDomains: Domain[] = []
  for (const domain of domains) {
    poller?.onStart?.(domain)
    const readyDomain = await waitForDomain(platform, appIdentity, domain, waitIntervalMs, timeoutMs, signal)
    poller?.onStop?.(domain)

    readyDomains.push(readyDomain)
  }

  return readyDomains
}

async function waitForDomain(
  platform: ResourceCtx['platform'],
  appIdentity: string,
  domain: Domain,
  waitIntervalMs: number,
  timeoutMs: number | undefined,
  signal: AbortSignal | undefined,
): Promise<Domain> {
  const deadline = timeoutMs === undefined ? undefined : Date.now() + timeoutMs

  while (domain.status === 'pending') {
    await wait(waitIntervalMs, signal)
    const updatedDomain = await platform.domain.info(appIdentity, domain.id)
    domain = updatedDomain

    if (domain.status === 'pending' && deadline !== undefined && Date.now() >= deadline) {
      throw new Error(`Timed out waiting for domain ${domain.hostname}`)
    }
  }

  if (domain.status === 'succeeded' || domain.status === 'none') {
    return domain
  }

  throw new Error(`The domain creation finished with status ${domain.status}`)
}
