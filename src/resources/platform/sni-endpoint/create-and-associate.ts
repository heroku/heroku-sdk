/* eslint-disable camelcase */
import type {SniEndpoint} from '@heroku/types/3.sdk'

import type {ResourceCtx} from '../../../core/extend-resource.js'
import type {Poller} from '../../../utils/poller.js'

import {withSignal} from '../../../core/with-signal.js'
import {isAbortError} from '../../../utils/is-abort-error.js'
import {waitForReady} from '../domain/wait-for-ready.js'
import {CertificateDomainsMismatchError, certificateNames, matchDomains} from './certificate-domains.js'

const DEFAULT_WAIT_INTERVAL_MS = 1000
const DEFAULT_TIMEOUT_MS = 30_000

type CreateAndAssociateCommonOptions = {
  /**
   * Progress hooks for the domain readiness wait:
   * `domainPoller.onStart()` before polling begins, `domainPoller.onStop()`
   * once the app's domains reach ready status.
   */
  domainPoller?: Poller
  intervalMs?: number
  signal?: AbortSignal
  timeoutMs?: number
}

/**
 * Thrown when a step after the upload fails (the domain wait, `resolveDomains`, or an
 * association). The certificate exists on the app by then, so the error carries the
 * created endpoint for cleanup; the original error is its `cause`.
 */
export class SniEndpointAssociationError extends Error {
  constructor(
    public readonly appIdentity: string,
    public readonly sniEndpoint: SniEndpoint,
    cause: unknown,
  ) {
    const reason = cause instanceof Error ? cause.message : String(cause)
    super(`The certificate was uploaded to ${appIdentity} as ${sniEndpoint.name}, but associating it with domains failed: ${reason}`, {cause})
    this.name = 'SniEndpointAssociationError'
  }
}

/** Pass exactly one of `domains` (a fixed list, checked before upload) or `resolveDomains` (chosen after upload). */
export type CreateAndAssociateOptions = CreateAndAssociateCommonOptions & ({
  /**
   * The hostnames to associate, for callers that can't prompt. Checked before
   * anything is uploaded: each must be one of the app's domains and covered by the
   * certificate (see `certificateNames`), or a `CertificateDomainsMismatchError` is
   * thrown. `[]` associates none.
   */
  domains: string[]
  resolveDomains?: never
} | {
  domains?: never
  /** Given the wildcard-matched candidate hostnames, returns the subset to associate. */
  resolveDomains: (candidates: string[]) => Promise<string[]>
})

/**
 * Create an SNI endpoint (SSL certificate) on an app and associate it with the
 * app's matching domains.
 *
 * Ports the CLI `certs:add` business logic into the SDK.
 *
 * Steps:
 * 0. With `domains`, check the requested hostnames before uploading (see
 *    `CreateAndAssociateOptions.domains`).
 * 1. Create the SNI endpoint from the given certificate chain and private key.
 * 2. Wait for the app's domains to reach ready status (replaces the old CNAME poll).
 *    The SDK waits on domain STATUS (`succeeded`/`none`) via `domain.waitForReady`
 *    rather than the CLI's old `cname`-defined readiness check, polling at a default
 *    1000ms interval to mirror the CLI's `waitForDomains` cadence. `timeoutMs`
 *    defaults to 30s and is applied per pending domain (not a single global budget),
 *    so an app with several pending domains can wait longer than 30s overall.
 * 3. List the (now stable) app domains and wildcard-match them against the
 *    certificate's `cert_domains`.
 * 4. With `resolveDomains`: if any domains matched, invoke it — the interactive
 *    selection hook the consumer supplies — to choose which matched hostnames to
 *    associate. With `domains`, associate exactly those (steps 3 and 4 are skipped).
 * 5. Associate the selected hostnames with the endpoint in parallel via
 *    `PATCH /apps/{app}/domains/{hostname}` (`domain.update`).
 *
 * If no domains match the certificate, neither `resolveDomains` nor any
 * association call is made.
 *
 * @throws `CertificateDomainsMismatchError` (before upload) if `domains` names a
 * hostname that isn't on the app or isn't covered by the certificate.
 * @throws `SniEndpointAssociationError` (after upload, naming the created endpoint) if
 * the domain readiness wait times out or a domain fails, `resolveDomains` throws, or
 * an association call rejects. An abort is rethrown as is.
 * @returns the SNI endpoint. When domains were associated, it's re-fetched so its
 * `domains` list includes them.
 */
// Signature mirrors the CLI `certs:add` / plan-locked public API:
// createAndAssociate(app, certChain, privateKey, {resolveDomains} | {domains}).
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
    signal,
    timeoutMs = DEFAULT_TIMEOUT_MS,
  } = options

  signal?.throwIfAborted()

  const platform = withSignal(ctx.platform, signal)

  if (options.domains) {
    await checkRequestedDomains(ctx, appIdentity, certificateChain, {requested: options.domains, signal})
  }

  const sniEndpoint = await platform.sniEndpoint.create(appIdentity, {
    certificate_chain: certificateChain,
    private_key: privateKey,
  })

  try {
    return await associate(ctx, appIdentity, sniEndpoint, {
      domainPoller, intervalMs, options, signal, timeoutMs,
    })
  } catch (error) {
    // Cancellation keeps its usual shape; callers that abort know the upload may have happened.
    if (signal?.aborted || isAbortError(error)) throw error
    throw new SniEndpointAssociationError(appIdentity, sniEndpoint, error)
  }
}

async function associate(
  ctx: Pick<ResourceCtx, 'platform'>,
  appIdentity: string,
  sniEndpoint: SniEndpoint,
  {domainPoller, intervalMs, options, signal, timeoutMs}: {
    domainPoller?: Poller; intervalMs: number; options: CreateAndAssociateOptions; signal?: AbortSignal; timeoutMs: number
  },
): Promise<SniEndpoint> {
  const platform = withSignal(ctx.platform, signal)
  domainPoller?.onStart?.()
  await waitForReady(ctx, appIdentity, {signal, timeoutMs, waitIntervalMs: intervalMs})
  domainPoller?.onStop?.()

  let selected: string[] = []
  if (options.domains) {
    selected = options.domains
  } else {
    const apiDomains = await platform.domain.list(appIdentity)
    const appDomains = apiDomains.map(d => d.hostname)

    const certDomains = (sniEndpoint.ssl_cert.cert_domains ?? []) as string[]
    const matched = matchDomains(certDomains, appDomains)
    if (matched.length > 0) selected = await options.resolveDomains(matched)
  }

  if (selected.length === 0) return sniEndpoint

  await Promise.all(selected.map(hostname => platform.domain.update(appIdentity, hostname, {sni_endpoint: sniEndpoint.name})))
  // The create response predates the associations, so its `domains` list is stale.
  return platform.sniEndpoint.info(appIdentity, sniEndpoint.id)
}

async function checkRequestedDomains(
  ctx: Pick<ResourceCtx, 'platform'>,
  appIdentity: string,
  certificateChain: string,
  {requested, signal}: {requested: string[]; signal?: AbortSignal},
): Promise<void> {
  if (requested.length === 0) return

  const names = certificateNames(certificateChain)
  const appDomains = new Set((await withSignal(ctx.platform, signal).domain.list(appIdentity)).map(d => d.hostname))
  const notOnApp = requested.filter(hostname => !appDomains.has(hostname))
  const notCovered = requested.filter(hostname => appDomains.has(hostname) && matchDomains(names, [hostname]).length === 0)
  if (notOnApp.length > 0 || notCovered.length > 0) {
    throw new CertificateDomainsMismatchError(appIdentity, notOnApp, notCovered)
  }
}
