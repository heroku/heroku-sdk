/* eslint-disable camelcase */
import type {Domain, SniEndpoint} from '@heroku/types/3.sdk'

import type {ResourceCtx} from '../../../core/extend-resource.js'
import type {Poller} from '../../../utils/poller.js'

import {withSignal} from '../../../core/with-signal.js'
import {isAbortError} from '../../../utils/is-abort-error.js'
import {waitForReady} from '../domain/wait-for-ready.js'
import {
  CertificateDomainsMismatchError, CertificateDomainsRequiredError, certificateNames, matchDomains,
} from './certificate-domains.js'

const DEFAULT_WAIT_INTERVAL_MS = 1000
const DEFAULT_TIMEOUT_MS = 30_000

/** A PEM certificate chain (leaf first) and its private key. */
export type SniCertificate = {
  certificateChain: string
  privateKey: string
}

type CreateAndAssociateCommonOptions = {
  /**
   * Progress hooks for the domain readiness wait after upload: `domainPoller.onStart()`
   * before polling begins, `domainPoller.onStop()` once the domains are ready. Not called
   * when there's nothing to wait for. If the wait throws, `onStop` isn't called (see `Poller`).
   */
  domainPoller?: Poller
  intervalMs?: number
  signal?: AbortSignal
  timeoutMs?: number
}

/**
 * Thrown when a step after the upload fails (the domain wait, `chooseDomains`, or an
 * association). The certificate exists on the app by then, so the error names the
 * created endpoint for cleanup; the original error is its `cause`, and its `statusCode`
 * is the cause's, when it has one.
 */
export class SniEndpointAssociationError extends Error {
  public readonly id = 'association_failed'
  public readonly statusCode: number | undefined

  constructor(
    public readonly appIdentity: string,
    public readonly sniEndpoint: SniEndpoint,
    cause: unknown,
  ) {
    const reason = cause instanceof Error ? cause.message : String(cause)
    super(`The certificate was uploaded to ${appIdentity} as ${sniEndpoint.name}, but associating it with domains failed: ${reason}`, {cause})
    this.name = 'SniEndpointAssociationError'
    const causeStatus = (cause as undefined | {statusCode?: unknown})?.statusCode
    this.statusCode = typeof causeStatus === 'number' ? causeStatus : undefined
  }

  public get body() {
    return {id: this.id, message: this.message, sni_endpoint: {id: this.sniEndpoint.id, name: this.sniEndpoint.name}}
  }
}

/**
 * How to choose the hostnames to associate. Pass at most one of:
 *   - `domains`: a fixed list, checked before upload.
 *   - `chooseDomains`: a callback that chooses from the matching hostnames after upload.
 *   - neither: associate none, but only if the certificate covers none of the app's domains;
 *     otherwise throws `CertificateDomainsRequiredError` before upload, listing them.
 */
export type CreateAndAssociateOptions = CreateAndAssociateCommonOptions & ({
  /** Given the app hostnames the certificate covers, returns the subset to associate. */
  chooseDomains: (candidates: string[]) => Promise<string[]>
  domains?: never
} | {
  chooseDomains?: never
  /**
   * The hostnames to associate, for callers that can't prompt. Checked before
   * anything is uploaded: each must be one of the app's domains (case-insensitively)
   * and covered by the certificate (see `certificateNames`), or a
   * `CertificateDomainsMismatchError` is thrown. `[]` associates none.
   */
  domains: string[]
} | {
  chooseDomains?: never
  domains?: never
})

/**
 * Create an SNI endpoint (SSL certificate) on an app and associate it with the
 * app's matching domains.
 *
 * Which domains a certificate covers is read locally from the certificate (see
 * `certificateNames` and `certificateNameCovers`), so it can be checked before upload.
 *
 * Steps:
 * 1. Read the certificate's names. With `domains`, check the requested hostnames;
 *    with neither option, check that the certificate covers none of the app's domains.
 * 2. Create the SNI endpoint.
 * 3. Wait for domains to reach ready status (`succeeded`/`none`): the requested ones
 *    with `domains`, all of the app's pending domains with `chooseDomains`. `timeoutMs`
 *    (default 30s) applies per pending domain, polling every `intervalMs` (default 1s).
 * 4. With `chooseDomains`: list the app's domains and, if the certificate covers any,
 *    call `chooseDomains` with them to choose which to associate.
 * 5. Associate the chosen hostnames with the endpoint in parallel (`domain.update`).
 *
 * @throws `TypeError` (before upload) if both `domains` and `chooseDomains` are passed.
 * @throws `CertificateParseError` (before upload) if the certificate chain can't be read.
 * @throws `CertificateDomainsMismatchError` (before upload) if `domains` names a
 * hostname that isn't on the app or isn't covered by the certificate.
 * @throws `CertificateDomainsRequiredError` (before upload) if neither option is passed
 * and the certificate covers some of the app's domains.
 * @throws `SniEndpointAssociationError` (after upload, naming the created endpoint) if
 * the domain readiness wait times out or a domain fails, `chooseDomains` throws, or
 * an association call rejects. An abort is rethrown as is.
 * @returns the SNI endpoint. When domains were associated, it's re-fetched so its
 * `domains` list includes them; if that re-fetch fails, its error is thrown as is
 * (the associations were made).
 */
export async function createAndAssociate(
  ctx: Pick<ResourceCtx, 'platform'>,
  appIdentity: string,
  certificate: SniCertificate,
  options: CreateAndAssociateOptions = {},
): Promise<SniEndpoint> {
  const {
    domainPoller,
    intervalMs = DEFAULT_WAIT_INTERVAL_MS,
    signal,
    timeoutMs = DEFAULT_TIMEOUT_MS,
  } = options

  signal?.throwIfAborted()
  if (options.domains !== undefined && options.chooseDomains !== undefined) {
    throw new TypeError('Pass domains or chooseDomains, not both.')
  }

  const platform = withSignal(ctx.platform, signal)
  const names = await certificateNames(certificate.certificateChain)

  let requested: Domain[] = []
  if (options.domains) {
    requested = await checkRequestedDomains(ctx, appIdentity, names, {requested: options.domains, signal})
  } else if (!options.chooseDomains) {
    const matches = matchDomains(names, (await platform.domain.list(appIdentity)).map(d => d.hostname))
    if (matches.length > 0) throw new CertificateDomainsRequiredError(appIdentity, matches)
  }

  const sniEndpoint = await platform.sniEndpoint.create(appIdentity, {
    certificate_chain: certificate.certificateChain,
    private_key: certificate.privateKey,
  })

  const waitOptions = {signal, timeoutMs, waitIntervalMs: intervalMs}
  let selected: string[]
  try {
    if (options.chooseDomains) {
      await withPoller(domainPoller, () => waitForReady(ctx, appIdentity, waitOptions))
      const covered = matchDomains(names, (await platform.domain.list(appIdentity)).map(d => d.hostname))
      selected = covered.length > 0 ? await options.chooseDomains(covered) : []
    } else {
      if (requested.length > 0) {
        await withPoller(domainPoller, () => Promise.all(requested.map(domain => waitForReady(ctx, appIdentity, {...waitOptions, domain}))))
      }

      selected = requested.map(domain => domain.hostname)
    }

    await Promise.all(selected.map(hostname => platform.domain.update(appIdentity, hostname, {sni_endpoint: sniEndpoint.name})))
  } catch (error) {
    // Cancellation keeps its usual shape; callers that abort know the upload may have happened.
    if (signal?.aborted || isAbortError(error)) throw error
    throw new SniEndpointAssociationError(appIdentity, sniEndpoint, error)
  }

  if (selected.length === 0) return sniEndpoint
  // The create response predates the associations, so its `domains` list is stale.
  return platform.sniEndpoint.info(appIdentity, sniEndpoint.id)
}

async function withPoller<T>(poller: Poller | undefined, wait: () => Promise<T>): Promise<T> {
  poller?.onStart?.()
  const result = await wait()
  poller?.onStop?.()
  return result
}

/** The app's domains for the requested hostnames, or throws `CertificateDomainsMismatchError`. */
async function checkRequestedDomains(
  ctx: Pick<ResourceCtx, 'platform'>,
  appIdentity: string,
  names: string[],
  {requested, signal}: {requested: string[]; signal?: AbortSignal},
): Promise<Domain[]> {
  if (requested.length === 0) return []

  const appDomains = new Map((await withSignal(ctx.platform, signal).domain.list(appIdentity)).map(d => [d.hostname.toLowerCase(), d]))
  const notOnApp = requested.filter(hostname => !appDomains.has(hostname.toLowerCase()))
  const notCovered = requested.filter(hostname => appDomains.has(hostname.toLowerCase()) && matchDomains(names, [hostname]).length === 0)
  if (notOnApp.length > 0 || notCovered.length > 0) {
    throw new CertificateDomainsMismatchError(appIdentity, notOnApp, notCovered)
  }

  // Deduplicated, so a hostname passed twice is waited on and associated once.
  return [...new Set(requested.map(hostname => appDomains.get(hostname.toLowerCase())!))]
}
