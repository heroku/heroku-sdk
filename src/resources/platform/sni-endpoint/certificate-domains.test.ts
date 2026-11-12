import {readFileSync} from 'node:fs'
import {
  describe, expect, it, vi,
} from 'vitest'

import type {ResourceCtx} from '../../../core/extend-resource.js'

import {buildDomain} from '../domain/test-utils.js'
import {certificateNames, matchCertificateDomains} from './certificate-domains.js'

// Fake, expired, self-signed fixtures (see the comment at the top of each file).
// san.pem: CN=www.example.com, SAN DNS:www.example.com, DNS:*.api.example.com
// cn-only.pem: CN=example.org, no SAN
const sanCert = readFileSync(new URL('fixtures/san.pem', import.meta.url), 'utf8')
const cnOnlyCert = readFileSync(new URL('fixtures/cn-only.pem', import.meta.url), 'utf8')

function buildCtx(hostnames: string[]): ResourceCtx {
  const platform = {
    domain: {list: vi.fn().mockResolvedValue(hostnames.map((hostname, i) => buildDomain({hostname, id: `d${i}`})))},
    withOptions: vi.fn(),
  }
  platform.withOptions.mockReturnValue(platform)
  return {data: {} as never, platform: platform as never}
}

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

  it('throws for something that is not a PEM certificate', () => {
    expect(() => certificateNames('not a certificate')).toThrow()
  })
})

describe('matchCertificateDomains', () => {
  it('returns the app hostnames the certificate covers, before anything is uploaded', async () => {
    const ctx = buildCtx(['www.example.com', 'v1.api.example.com', 'a.b.api.example.com', 'example.com', 'other.org'])

    const matched = await matchCertificateDomains(ctx, 'my-app', sanCert)

    expect(matched).toEqual(['www.example.com', 'v1.api.example.com'])
    expect(ctx.platform.domain.list).toHaveBeenCalledExactlyOnceWith('my-app')
  })

  it('returns [] when nothing matches', async () => {
    expect(await matchCertificateDomains(buildCtx(['other.org']), 'my-app', sanCert)).toEqual([])
  })

  it('threads the signal through withOptions', async () => {
    const ctx = buildCtx([])
    const controller = new AbortController()

    await matchCertificateDomains(ctx, 'my-app', sanCert, {signal: controller.signal})

    expect(ctx.platform.withOptions).toHaveBeenCalledWith({signal: controller.signal})
  })
})
