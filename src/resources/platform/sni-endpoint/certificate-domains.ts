/* eslint-disable camelcase */
import {X509Certificate} from 'node:crypto'

/** Thrown before upload when the certificate chain isn't a readable PEM certificate. */
export class CertificateParseError extends Error {
  public readonly id = 'invalid_certificate'
  public readonly statusCode = 422

  constructor(cause: unknown) {
    super('Couldn\'t read the certificate: expected a PEM-encoded certificate chain. Nothing was uploaded.', {cause})
    this.name = 'CertificateParseError'
  }

  public get body() {
    return {id: this.id, message: this.message}
  }
}

/**
 * Thrown before upload when a hostname passed to `createAndAssociate`'s `domains`
 * option isn't one of the app's domains, or isn't covered by the certificate.
 */
export class CertificateDomainsMismatchError extends Error {
  public readonly id = 'domains_mismatch'
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
    return {
      id: this.id, message: this.message, not_covered: this.notCovered, not_on_app: this.notOnApp,
    }
  }
}

/**
 * Thrown before upload when `createAndAssociate` gets neither `domains` nor
 * `resolveDomains` and the certificate covers some of the app's domains, so the caller
 * has to choose which to associate. `matches` lists them.
 */
export class CertificateDomainsRequiredError extends Error {
  public readonly id = 'domains_required'
  public readonly statusCode = 422

  constructor(public readonly appIdentity: string, public readonly matches: string[]) {
    super(`The certificate covers ${matches.join(', ')} on ${appIdentity}. Pass the hostnames to associate, or none. Nothing was uploaded.`)
    this.name = 'CertificateDomainsRequiredError'
  }

  public get body() {
    return {id: this.id, matches: this.matches, message: this.message}
  }
}

/**
 * The DNS names a certificate covers, read locally from the first (leaf) certificate
 * in a PEM chain: its subjectAltName DNS entries, or its subject CN when it has none.
 * Lowercased. `createAndAssociate` matches app domains against these, before and after
 * upload; once uploaded, the API's `ssl_cert.cert_domains` is authoritative.
 *
 * @throws `CertificateParseError` if the chain isn't a parseable PEM certificate.
 */
export function certificateNames(certificateChain: string): string[] {
  let certificate: X509Certificate
  try {
    certificate = new X509Certificate(certificateChain)
  } catch (error) {
    throw new CertificateParseError(error)
  }

  const dnsNames = parseSubjectAltName(certificate.subjectAltName ?? '')
  if (dnsNames.length > 0) return dnsNames.map(name => name.toLowerCase())

  const commonName = certificate.subject.split('\n').find(line => line.startsWith('CN='))
  return commonName ? [unquote(commonName.slice('CN='.length)).toLowerCase()] : []
}

/**
 * The DNS entries of a Node `X509Certificate.subjectAltName` string. Node separates
 * entries with `, ` and JSON-quotes values containing special characters (so a quoted
 * value can itself contain `, `); this splits only outside quotes.
 */
export function parseSubjectAltName(subjectAltName: string): string[] {
  const entries = subjectAltName.match(/(?:[^",]|"(?:[^"\\]|\\.)*")+/g) ?? []
  return entries
    .map(entry => entry.trim())
    .filter(entry => entry.startsWith('DNS:'))
    .map(entry => unquote(entry.slice('DNS:'.length)))
}

// Node JSON-quotes subjectAltName and subject values that contain special characters.
function unquote(value: string): string {
  return value.startsWith('"') ? JSON.parse(value) as string : value
}

/**
 * Whether a certificate name covers a hostname, case-insensitively. An exact name
 * matches only itself; a wildcard (`*.example.com`) matches exactly one extra label
 * (`www.example.com`), not the apex or deeper names (`a.b.example.com`), and not names
 * that only contain it (`www.example.com.evil.org`). Plain string comparison: a
 * certificate's names are never interpreted as patterns.
 */
export function certificateNameCovers(certificateName: string, hostname: string): boolean {
  const name = certificateName.toLowerCase()
  const host = hostname.toLowerCase()
  if (!name.startsWith('*.')) return name === host

  const suffix = name.slice(1)
  if (!host.endsWith(suffix)) return false
  const label = host.slice(0, -suffix.length)
  return label.length > 0 && !label.includes('.') && !label.includes('*')
}

/** The hostnames covered by any of the certificate's names, in `hostnames` order. */
export function matchDomains(certificateNames: string[], hostnames: string[]): string[] {
  return hostnames.filter(hostname => certificateNames.some(name => certificateNameCovers(name, hostname)))
}
