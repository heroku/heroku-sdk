import {describe, expect, it} from 'vitest'

import {platformBaseUrlFromEnv} from './heroku-host.js'

describe('platformBaseUrlFromEnv', () => {
  it('returns undefined when HEROKU_HOST is unset', () => {
    // eslint-disable-next-line unicorn/no-useless-undefined
    expect(platformBaseUrlFromEnv(undefined)).toBeUndefined()
    expect(platformBaseUrlFromEnv('')).toBeUndefined()
  })

  it('maps a bare host to an api-prefixed https URL', () => {
    expect(platformBaseUrlFromEnv('staging.herokudev.com')).toBe('https://api.staging.herokudev.com')
    expect(platformBaseUrlFromEnv('heroku.com')).toBe('https://api.heroku.com')
  })

  it('uses a full URL verbatim', () => {
    expect(platformBaseUrlFromEnv('https://api.custom.example.com')).toBe('https://api.custom.example.com')
    expect(platformBaseUrlFromEnv('http://localhost:5000')).toBe('http://localhost:5000')
  })
})
