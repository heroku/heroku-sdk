import {readFileSync} from 'node:fs'
import {describe, expect, it} from 'vitest'

import {
  certificateNameCovers, certificateNames, CertificateParseError, matchDomains, parseSubjectAltName,
} from './certificate-domains.js'

// Fake, expired, self-signed fixtures (see the comment at the top of each file).
// san.pem: CN=www.example.com, SAN DNS:www.example.com, DNS:*.api.example.com
// cn-only.pem: CN=example.org, no SAN
const sanCert = readFileSync(new URL('fixtures/san.pem', import.meta.url), 'utf8')
const cnOnlyCert = readFileSync(new URL('fixtures/cn-only.pem', import.meta.url), 'utf8')

describe('certificateNames', () => {
  it('reads the subjectAltName DNS entries', () => {
    expect(certificateNames(sanCert)).toEqual(['www.example.com', '*.api.example.com'])
  })

  it('falls back to the subject CN when there is no subjectAltName', () => {
    expect(certificateNames(cnOnlyCert)).toEqual(['example.org'])
  })

  it('reads the first certificate of a chain', () => {
    expect(certificateNames(sanCert + cnOnlyCert)).toEqual(['www.example.com', '*.api.example.com'])
  })

  it('throws CertificateParseError for something that is not a PEM certificate', () => {
    let error: unknown
    try {
      certificateNames('not a certificate')
    } catch (error_) {
      error = error_
    }

    expect(error).toBeInstanceOf(CertificateParseError)
    expect(error).toMatchObject({
      id: 'invalid_certificate',
      message: 'Couldn\'t read the certificate: expected a PEM-encoded certificate chain. Nothing was uploaded.',
      statusCode: 422,
    })
    expect((error as Error).cause).toBeInstanceOf(Error)
  })
})

describe('parseSubjectAltName', () => {
  it('keeps DNS entries only', () => {
    expect(parseSubjectAltName('DNS:www.example.com, IP Address:127.0.0.1, DNS:*.example.com')).toEqual(['www.example.com', '*.example.com'])
  })

  it('doesn\'t split a quoted value at its comma', () => {
    expect(parseSubjectAltName('DNS:"a.example.com, DNS:b.example.com", DNS:c.example.com')).toEqual(['a.example.com, DNS:b.example.com', 'c.example.com'])
  })

  it('returns [] for an empty string', () => {
    expect(parseSubjectAltName('')).toEqual([])
  })
})

describe('certificateNameCovers', () => {
  it.each([
    ['www.example.com', 'www.example.com', true],
    ['www.example.com', 'WWW.Example.com', true],
    ['WWW.EXAMPLE.COM', 'www.example.com', true],
    ['www.example.com', 'api.example.com', false],
    ['test.com', 'test.com.evil.org', false],
    ['*.example.com', 'www.example.com', true],
    ['*.example.com', 'WWW.EXAMPLE.COM', true],
    ['*.example.com', 'example.com', false],
    ['*.example.com', '.example.com', false],
    ['*.example.com', 'a.b.example.com', false],
    ['*.example.com', 'www.example.com.evil.org', false],
    ['*.example.com', 'wwwexample.com', false],
  ])('%s covers %s: %s', (name, hostname, expected) => {
    expect(certificateNameCovers(name, hostname)).toBe(expected)
  })

  it('never treats a name as a pattern', () => {
    // A self-signed certificate can carry any string as a name.
    expect(certificateNameCovers('a.b|.*', 'www.example.com')).toBe(false)
    expect(certificateNameCovers('*.b|.*', 'www.example.com')).toBe(false)
    expect(certificateNameCovers('www.example.co.', 'www.example.com')).toBe(false)
  })

  it('returns quickly for a name that would backtrack as a regex', () => {
    const start = Date.now()
    expect(certificateNameCovers(`*.${'(a+)+'.repeat(10)}b`, `x.${'a'.repeat(40)}`)).toBe(false)
    expect(Date.now() - start).toBeLessThan(100)
  })
})

describe('matchDomains', () => {
  it('returns the hostnames any name covers, in hostname order', () => {
    expect(matchDomains(
      ['www.example.com', '*.api.example.com'],
      ['v1.api.example.com', 'a.b.api.example.com', 'example.com', 'www.example.com', 'www.example.com.evil.org'],
    )).toEqual(['v1.api.example.com', 'www.example.com'])
  })

  it('matches exact names without a wildcard among them', () => {
    expect(matchDomains(['test.com'], ['test.com', 'test.com.evil.org', 'www.test.com'])).toEqual(['test.com'])
  })

  it('returns [] when nothing matches', () => {
    expect(matchDomains(['www.example.com'], ['other.org'])).toEqual([])
  })
})
