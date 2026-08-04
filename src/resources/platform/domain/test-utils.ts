/* eslint-disable camelcase */
import type {Domain, SniEndpoint} from '@heroku/types/3.sdk'

import {vi} from 'vitest'

import type {ResourceCtx} from '../../../core/extend-resource.js'

export type FakePlatform = {
  domain: {
    create: ReturnType<typeof vi.fn>
    delete: ReturnType<typeof vi.fn>
    info: ReturnType<typeof vi.fn>
    list: ReturnType<typeof vi.fn>
  }
  sniEndpoint: {
    list: ReturnType<typeof vi.fn>
  }
  withOptions: ReturnType<typeof vi.fn>
}

export function buildCtx(stubs: {
  domainCreate?: ReturnType<typeof vi.fn>
  domainDelete?: ReturnType<typeof vi.fn>
  domainInfo?: ReturnType<typeof vi.fn>
  domainList?: ReturnType<typeof vi.fn>
  sniEndpointList?: ReturnType<typeof vi.fn>
} = {}): ResourceCtx {
  const platform: FakePlatform = {
    domain: {
      create: stubs.domainCreate ?? vi.fn().mockResolvedValue({}),
      delete: stubs.domainDelete ?? vi.fn().mockResolvedValue({}),
      info: stubs.domainInfo ?? vi.fn().mockResolvedValue({}),
      list: stubs.domainList ?? vi.fn().mockResolvedValue([]),
    },
    sniEndpoint: {
      list: stubs.sniEndpointList ?? vi.fn().mockResolvedValue([]),
    },
    withOptions: vi.fn(function (this: any) {
      return this
    }),
  }
  platform.withOptions.mockReturnValue(platform)

  return {
    data: {} as never,
    metrics: {} as never,
    platform: platform as never,
  }
}

export function buildDomain(overrides: Partial<Domain> = {}): Domain {
  return {
    acm_status: null,
    acm_status_reason: null,
    app: {id: 'app-123', name: 'test-app'},
    cname: 'example.herokuapp.com',
    created_at: '2024-01-01T00:00:00Z',
    hostname: 'example.com',
    id: 'domain-123',
    kind: 'custom',
    sni_endpoint: null,
    status: 'pending',
    updated_at: '2024-01-01T00:00:00Z',
    ...overrides,
  }
}

export function buildSniEndpoint(overrides: Partial<SniEndpoint> = {}): SniEndpoint {
  return {
    app: {id: 'app-123', name: 'test-app'},
    certificate_chain: '-----BEGIN CERTIFICATE-----',
    created_at: '2024-01-01T00:00:00Z',
    display_name: 'example.com cert',
    domains: ['example.com'],
    id: 'sni-123',
    name: 'tokyo-1234',
    ssl_cert: {
      'ca_signed?': true,
      cert_domains: ['example.com'],
      expires_at: '2025-01-01T00:00:00Z',
      issuer: 'Let\'s Encrypt',
      'self_signed?': false,
      starts_at: '2024-01-01T00:00:00Z',
      subject: 'CN=example.com',
    },
    updated_at: '2024-01-01T00:00:00Z',
    ...overrides,
  }
}
