/* eslint-disable camelcase */
import type {SniEndpoint} from '@heroku/types/3.sdk'

import type {ResourceCtx} from '../../../core/extend-resource.js'
import type {Poller} from '../../../utils/poller.js'

import {waitForReady} from '../domain/wait-for-ready.js'

const DEFAULT_WAIT_INTERVAL_MS = 1000
const DEFAULT_TIMEOUT_MS = 30_000

export type CreateAndAssociateOptions = {
  /**
   * Progress hooks for the domain readiness wait:
   * `domainPoller.onStart()` before polling begins, `domainPoller.onStop()`
   * once the app's domains reach ready status.
   */
  domainPoller?: Poller
  intervalMs?: number
  /** Required. Given the wildcard-matched candidate hostnames, returns the subset to associate. */
  resolveDomains: (candidates: string[]) => Promise<string[]>
  signal?: AbortSignal
  timeoutMs?: number
}

/**
 * Create an SNI endpoint (SSL certificate) on an app and associate it with the
 * app's matching domains.
 *
 * Ports the CLI `certs:add` business logic into the SDK.
 *
 * Steps:
 * 1. Create the SNI endpoint from the given certificate chain and private key.
 * 2. Wait for the app's domains to reach ready status (replaces the old CNAME poll).
 *    The SDK waits on domain STATUS (`succeeded`/`none`) via `domain.waitForReady`
 *    rather than the CLI's old `cname`-defined readiness check, polling at a default
 *    1000ms interval to mirror the CLI's `waitForDomains` cadence. `timeoutMs`
 *    defaults to 30s and is applied per pending domain (not a single global budget),
 *    so an app with several pending domains can wait longer than 30s overall.
 * 3. List the (now stable) app domains and wildcard-match them against the
 *    certificate's `cert_domains`.
 * 4. If any domains matched, invoke `resolveDomains` — the interactive selection
 *    hook the consumer supplies — to choose which matched hostnames to associate.
 * 5. Associate the selected hostnames with the endpoint in parallel via
 *    `PATCH /apps/{app}/domains/{hostname}` (`domain.update`).
 *
 * If no domains match the certificate, neither `resolveDomains` nor any
 * association call is made.
 *
 * @throws if the domain readiness wait times out or a domain fails, or if any
 * association call rejects.
 * @returns the created SNI endpoint.
 */
// Signature mirrors the CLI `certs:add` / plan-locked public API:
// createAndAssociate(app, certChain, privateKey, {resolveDomains}).
// eslint-disable-next-line max-params
export async function createAndAssociate(
  ctx: Pick<ResourceCtx, 'platform'>,
  appIdentity: string,
  certificateChain: string,
  privateKey: string,
  options: CreateAndAssociateOptions,
): Promise<SniEndpoint> {
  const {
    domainPoller,
    intervalMs = DEFAULT_WAIT_INTERVAL_MS,
    resolveDomains,
    signal,
    timeoutMs = DEFAULT_TIMEOUT_MS,
  } = options

  signal?.throwIfAborted()

  const platform = signal ? ctx.platform.withOptions({signal}) : ctx.platform

  const sniEndpoint = await platform.sniEndpoint.create(appIdentity, {
    certificate_chain: certificateChain,
    private_key: privateKey,
  })

  domainPoller?.onStart?.()
  await waitForReady(ctx, appIdentity, {signal, timeoutMs, waitIntervalMs: intervalMs})
  domainPoller?.onStop?.()

  const apiDomains = await platform.domain.list(appIdentity)
  const appDomains = apiDomains.map(d => d.hostname)

  const certDomains = (sniEndpoint.ssl_cert.cert_domains ?? []) as string[]
  const matched = matchDomains(certDomains, appDomains)

  if (matched.length > 0) {
    const selected = await resolveDomains(matched)
    await Promise.all(selected.map(hostname => platform.domain.update(appIdentity, hostname, {sni_endpoint: sniEndpoint.name})))
  }

  return sniEndpoint
}

function splitDomains(domains: string[]): [string, string][] {
  return domains.map(domain => [domain.slice(0, 1), domain.slice(1)])
}

// Adapted from the CLI `certs/add.ts` matcher, but ADDS `^`/`$` anchors to fix a
// prefix-match bug: without them a wildcard cert like `*.example.com` would match
// hostnames that merely share a prefix (e.g. `www.example.com.evil.org`). Wildcard
// certs must not match such hostnames, so both ends of the pattern are anchored.
function createMatcherFromSplitDomain([firstChar, rest]: [string, string]) {
  const matcherContents = []
  if (firstChar === '*') {
    matcherContents.push(String.raw`^[\w\-]+`)
  } else {
    matcherContents.push(`^${firstChar}`)
  }

  const escapedRest = rest.replaceAll('.', String.raw`\.`)
  matcherContents.push(escapedRest)

  return new RegExp(`${matcherContents.join('')}$`)
}

function matchDomains(certDomains: string[], appDomains: string[]) {
  const splitCertDomains = splitDomains(certDomains)
  const matchers = splitCertDomains.map(splitDomain => createMatcherFromSplitDomain(splitDomain))

  if (splitCertDomains.some(domain => (domain[0] === '*'))) {
    const matchedDomains: string[] = []
    for (const appDomain of appDomains) {
      if (matchers.some(matcher => matcher.test(appDomain))) {
        matchedDomains.push(appDomain)
      }
    }

    return matchedDomains
  }

  return certDomains.filter(domain => appDomains.includes(domain))
}
