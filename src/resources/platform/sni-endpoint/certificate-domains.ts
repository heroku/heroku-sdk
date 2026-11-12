import {X509Certificate} from 'node:crypto'

import type {ResourceCtx} from '../../../core/extend-resource.js'

import {withSignal} from '../../../core/with-signal.js'

export type MatchCertificateDomainsOptions = {
  signal?: AbortSignal
}

/**
 * Thrown before upload when a hostname passed to `createAndAssociate`'s `domains`
 * option isn't one of the app's domains, or isn't covered by the certificate.
 */
export class CertificateDomainsMismatchError extends Error {
  public readonly id = 'invalid_params'
  public readonly statusCode = 422

  constructor(
    public readonly appIdentity: string,
    public readonly notOnApp: string[],
    public readonly notCovered: string[],
  ) {
    const problems = []
    if (notOnApp.length > 0) problems.push(`${notOnApp.join(', ')} ${notOnApp.length === 1 ? 'isn\'t a domain' : 'aren\'t domains'} on ${appIdentity}`)
    if (notCovered.length > 0) problems.push(`${notCovered.join(', ')} ${notCovered.length === 1 ? 'isn\'t' : 'aren\'t'} covered by the certificate`)
    super(`Can't associate the certificate: ${problems.join('; ')}. Nothing was uploaded.`)
    this.name = 'CertificateDomainsMismatchError'
  }

  public get body() {
    return {id: this.id, message: this.message}
  }
}

/**
 * The DNS names a certificate covers, read locally from the first (leaf) certificate
 * in a PEM chain: its subjectAltName DNS entries, or its subject CN when it has none.
 * The API's `ssl_cert.cert_domains` stays authoritative after upload; this is for
 * checks that have to happen before anything is sent.
 *
 * @throws if the chain isn't a parseable PEM certificate.
 */
export function certificateNames(certificateChain: string): string[] {
  const certificate = new X509Certificate(certificateChain)
  const dnsNames = (certificate.subjectAltName ?? '')
    .split(', ')
    .filter(entry => entry.startsWith('DNS:'))
    .map(entry => unquote(entry.slice('DNS:'.length)))
  if (dnsNames.length > 0) return dnsNames.map(name => name.toLowerCase())

  const commonName = certificate.subject.split('\n').find(line => line.startsWith('CN='))
  return commonName ? [unquote(commonName.slice('CN='.length)).toLowerCase()] : []
}

// Node JSON-quotes subjectAltName and subject values that contain special characters.
function unquote(value: string): string {
  return value.startsWith('"') ? JSON.parse(value) as string : value
}

/**
 * The app's hostnames that the certificate covers, computed before upload from the
 * certificate's own names (see `certificateNames`). Exact names match exactly; a
 * wildcard (`*.example.com`) matches one label (`www.example.com`), not deeper ones.
 */
export async function matchCertificateDomains(
  ctx: Pick<ResourceCtx, 'platform'>,
  appIdentity: string,
  certificateChain: string,
  options: MatchCertificateDomainsOptions = {},
): Promise<string[]> {
  const names = certificateNames(certificateChain)
  const platform = withSignal(ctx.platform, options.signal)
  const appDomains = (await platform.domain.list(appIdentity)).map(d => d.hostname)
  return matchDomains(names, appDomains)
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

/** App hostnames covered by any of the certificate's names. */
export function matchDomains(certDomains: string[], appDomains: string[]): string[] {
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
