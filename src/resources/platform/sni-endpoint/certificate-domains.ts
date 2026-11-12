/* eslint-disable camelcase */
import type * as Asn1 from 'asn1js'

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
 * Parsed with `asn1js`, which runs in Node and in browsers. It's loaded on first call,
 * so importing the SDK doesn't load it.
 *
 * @throws `CertificateParseError` if the chain isn't a parseable PEM certificate.
 */
export async function certificateNames(certificateChain: string): Promise<string[]> {
  const asn1 = await loadAsn1js()
  try {
    return readCertificateNames(asn1, leafCertificateDer(certificateChain)).map(name => name.toLowerCase())
  } catch (error) {
    throw new CertificateParseError(error)
  }
}

let asn1js: Promise<typeof Asn1> | undefined
function loadAsn1js(): Promise<typeof Asn1> {
  asn1js ??= import('asn1js')
  return asn1js
}

const PEM_CERTIFICATE = /-----BEGIN CERTIFICATE-----([\d\s+/=A-Za-z]*)-----END CERTIFICATE-----/
const OID_COMMON_NAME = '2.5.4.3'
const OID_SUBJECT_ALT_NAME = '2.5.29.17'
const TAG_CLASS_CONTEXT = 3
// Generous for a certificate; asn1js's defaults allow far more.
const PARSE_LIMITS = {
  maxContentLength: 1024 * 1024, maxDepth: 32, maxNodes: 10_000, parseEmbedded: false,
}

/** The DER bytes of the first `CERTIFICATE` block in a PEM string. */
function leafCertificateDer(certificateChain: string): Uint8Array {
  const match = PEM_CERTIFICATE.exec(certificateChain)
  if (!match) throw new Error('No PEM CERTIFICATE block.')
  // atob is the base64 decoder available in both browsers and Node (Buffer is Node-only).
  // eslint-disable-next-line no-restricted-globals
  return Uint8Array.from(atob(match[1].replaceAll(/\s/g, '')), char => char.codePointAt(0) ?? 0)
}

/**
 * The SAN DNS names, or else the first subject CN, of a DER certificate:
 *
 *   Certificate    ::= SEQUENCE { tbsCertificate, signatureAlgorithm, signature }
 *   TBSCertificate ::= SEQUENCE { [0] version OPTIONAL, serialNumber, signature, issuer,
 *                                 validity, subject, subjectPublicKeyInfo, ..., [3] extensions OPTIONAL }
 */
function readCertificateNames(asn1: typeof Asn1, der: Uint8Array): string[] {
  const [tbsCertificate] = children(asn1.Sequence, decode(asn1, der))
  const fields = children(asn1.Sequence, tbsCertificate)
  const subject = fields[(isContextTag(fields[0], 0) ? 1 : 0) + 4]
  const extensions = fields.find(field => isContextTag(field, 3))

  const dnsNames = extensions ? subjectAltNameDnsNames(asn1, extensions) : []
  if (dnsNames.length > 0) return dnsNames
  const commonName = subjectCommonName(asn1, subject)
  return commonName === undefined ? [] : [commonName]
}

/** `dNSName` entries ([2] IA5String) of the subjectAltName extension's GeneralNames. */
function subjectAltNameDnsNames(asn1: typeof Asn1, extensionsField: Asn1.BaseBlock): string[] {
  const [extensions] = children(asn1.Constructed, extensionsField)
  for (const extension of children(asn1.Sequence, extensions)) {
    const [extensionId, ...rest] = children(asn1.Sequence, extension)
    if (!(extensionId instanceof asn1.ObjectIdentifier) || extensionId.getValue() !== OID_SUBJECT_ALT_NAME) continue
    const extensionValue = rest.at(-1)
    if (!(extensionValue instanceof asn1.OctetString)) throw new Error('Malformed subjectAltName extension.')
    return children(asn1.Sequence, decode(asn1, extensionValue.valueBlock.valueHexView))
      .filter(name => isContextTag(name, 2) && !name.idBlock.isConstructed)
      .map(name => String.fromCodePoint(...(name.valueBlock as unknown as {valueHexView: Uint8Array}).valueHexView))
  }

  return []
}

/** The first `commonName` attribute in a Name (SEQUENCE OF SET OF {type, value}). */
function subjectCommonName(asn1: typeof Asn1, subject: Asn1.BaseBlock | undefined): string | undefined {
  for (const relativeName of children(asn1.Sequence, subject)) {
    for (const attribute of children(asn1.Set, relativeName)) {
      const [type, value] = children(asn1.Sequence, attribute)
      if (type instanceof asn1.ObjectIdentifier && type.getValue() === OID_COMMON_NAME && value instanceof asn1.BaseStringBlock) {
        return value.getValue()
      }
    }
  }

  return undefined
}

/** Decode exactly one DER value from `bytes`, within `PARSE_LIMITS`. */
function decode(asn1: typeof Asn1, bytes: Uint8Array): Asn1.BaseBlock {
  const {offset, result} = asn1.fromBER(bytes, PARSE_LIMITS)
  if (offset === -1 || offset !== bytes.byteLength || result.error) {
    throw new Error(`Malformed DER${result.error ? `: ${result.error}` : ''}.`)
  }

  return result as Asn1.BaseBlock
}

/** The children of a constructed `block` of type `type`; throws for anything else. */
function children(type: typeof Asn1.Constructed, block: Asn1.BaseBlock | undefined): Asn1.BaseBlock[] {
  if (!(block instanceof type)) throw new Error(`Expected ${type.NAME}.`)
  return block.valueBlock.value
}

function isContextTag(block: Asn1.BaseBlock | undefined, tagNumber: number): boolean {
  return block?.idBlock.tagClass === TAG_CLASS_CONTEXT && block.idBlock.tagNumber === tagNumber
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
