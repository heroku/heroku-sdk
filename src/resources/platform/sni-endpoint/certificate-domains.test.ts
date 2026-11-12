import {X509Certificate} from 'node:crypto'
import {readFileSync} from 'node:fs'
import {
  describe, expect, it, vi,
} from 'vitest'

import {
  certificateNameCovers, certificateNames, CertificateParseError, matchDomains,
} from './certificate-domains.js'

// Fake, expired, self-signed fixtures (see the comment at the top of each file).
// san.pem: CN=www.example.com, SAN DNS:www.example.com, DNS:*.api.example.com
// cn-only.pem: CN=example.org, no SAN
const sanCert = readFileSync(new URL('fixtures/san.pem', import.meta.url), 'utf8')
const cnOnlyCert = readFileSync(new URL('fixtures/cn-only.pem', import.meta.url), 'utf8')

describe('certificateNames', () => {
  it('reads the subjectAltName DNS entries', async () => {
    expect(await certificateNames(sanCert)).toEqual(['www.example.com', '*.api.example.com'])
  })

  it('falls back to the subject CN when there is no subjectAltName', async () => {
    expect(await certificateNames(cnOnlyCert)).toEqual(['example.org'])
  })

  it('reads the first certificate of a chain', async () => {
    expect(await certificateNames(sanCert + cnOnlyCert)).toEqual(['www.example.com', '*.api.example.com'])
  })

  it.each([['san.pem', sanCert], ['cn-only.pem', cnOnlyCert]])('agrees with node:crypto on %s', async (_, pem) => {
    const certificate = new X509Certificate(pem)
    const dnsNames = (certificate.subjectAltName ?? '').split(', ').filter(entry => entry.startsWith('DNS:')).map(entry => entry.slice(4))
    const commonName = certificate.subject.split('\n').find(line => line.startsWith('CN='))?.slice(3)
    expect(await certificateNames(pem)).toEqual(dnsNames.length > 0 ? dnsNames : [commonName])
  })

  it.each([
    ['not PEM', 'not a certificate'],
    ['an empty PEM block', '-----BEGIN CERTIFICATE-----\n-----END CERTIFICATE-----'],
    ['PEM armor around non-DER bytes', `-----BEGIN CERTIFICATE-----\n${Buffer.from('hello, world').toString('base64')}\n-----END CERTIFICATE-----`],
    ['a truncated certificate', sanCert.replace(/-----END CERTIFICATE-----[\s\S]*/, '').slice(0, -200) + '\n-----END CERTIFICATE-----'],
    ['DER that is not a certificate', `-----BEGIN CERTIFICATE-----\n${Buffer.from([0x02, 0x01, 0x05]).toString('base64')}\n-----END CERTIFICATE-----`],
    ['a private key', '-----BEGIN PRIVATE KEY-----\nMIIB\n-----END PRIVATE KEY-----'],
  ])('throws CertificateParseError for %s', async (_, pem) => {
    const error = await certificateNames(pem).catch((error_: unknown) => error_)

    expect(error).toBeInstanceOf(CertificateParseError)
    expect(error).toMatchObject({
      id: 'invalid_certificate',
      message: 'Couldn\'t read the certificate: expected a PEM-encoded certificate chain. Nothing was uploaded.',
      statusCode: 422,
    })
    expect((error as Error).cause).toBeInstanceOf(Error)
  })

  it('loads asn1js on first call, not on import', async () => {
    vi.resetModules()
    const loaded = vi.fn()
    vi.doMock('asn1js', async importOriginal => {
      loaded()
      return importOriginal()
    })

    try {
      const module = await import('./certificate-domains.js')
      // Let any import the module started on load settle.
      await new Promise(resolve => {
        setTimeout(resolve, 10)
      })
      expect(loaded).not.toHaveBeenCalled()

      expect(await module.certificateNames(sanCert)).toEqual(['www.example.com', '*.api.example.com'])
      expect(loaded).toHaveBeenCalledOnce()
    } finally {
      vi.doUnmock('asn1js')
      vi.resetModules()
    }
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
