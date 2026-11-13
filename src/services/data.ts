import type {HerokuApiClientOptions} from '@heroku/heroku-fetch'
import type {HerokuClient} from '@heroku/types/data'

import * as routes from '@heroku/types/data/routes'

import type {RoutesClientExtras} from '../core/create-client.js'

import {createClient} from '../core/create-client.js'
import {readEnv} from '../core/env.js'

export type DataClient = HerokuClient & RoutesClientExtras<HerokuClient>

const ALLOWED_HEROKU_DOMAINS = ['heroku.com', 'herokai.com', 'herokuspace.com', 'herokudev.com']
const LOCALHOST_DOMAINS = new Set(['127.0.0.1', '[::1]', 'localhost'])

function containsControlCharacter(value: string): boolean {
  return [...value].some(character => (character.codePointAt(0) ?? 0) <= 32 || character.codePointAt(0) === 127)
}

function isTrustedDataHost(url: URL): boolean {
  const isLocalhost = LOCALHOST_DOMAINS.has(url.hostname)
  const trustedDomain = ALLOWED_HEROKU_DOMAINS.some(domain => url.hostname === domain || url.hostname.endsWith(`.${domain}`))

  return (isLocalhost && ['http:', 'https:'].includes(url.protocol))
    || (trustedDomain && url.protocol === 'https:')
}

function parseDataHost(configuredHost: string): URL {
  if (/[?#]/.test(configuredHost) || containsControlCharacter(configuredHost) || configuredHost !== configuredHost.trim()) {
    throw new Error('Invalid data API host')
  }

  const urlInput = configuredHost.includes('://') ? configuredHost : `https://${configuredHost}`
  const urlParts = urlInput.match(/^[a-z][a-z\d+.-]*:\/\/([^/?#\\]*)(.*)$/i)
  if (!urlParts) throw new Error('Invalid data API host')
  const [, authority, path] = urlParts
  if (authority.includes('@') || authority.endsWith(':') || (path !== '' && path !== '/')) {
    throw new Error('Invalid data API host')
  }

  try {
    return new URL(urlInput)
  } catch {
    throw new Error('Invalid data API host')
  }
}

function dataHostBaseUrl(): string | undefined {
  const configuredHost = readEnv('HEROKU_DATA_HOST') || readEnv('HEROKU_POSTGRESQL_HOST') || 'api.data.heroku.com'

  const url = parseDataHost(configuredHost)

  if (!isTrustedDataHost(url)) {
    throw new Error('Refusing to send Heroku credentials to untrusted data API host')
  }

  if (url.username || url.password || url.search || url.hash) {
    throw new Error('Invalid data API host')
  }

  return url.origin
}

export function createDataClient(options: HerokuApiClientOptions = {}): DataClient {
  const clientOptions: HerokuApiClientOptions = {service: 'data', ...options}
  if (clientOptions.service === 'data' && !clientOptions.baseUrl) {
    const baseUrl = dataHostBaseUrl()
    if (baseUrl) clientOptions.baseUrl = baseUrl
  }

  return createClient<HerokuClient>(routes, clientOptions)
}
