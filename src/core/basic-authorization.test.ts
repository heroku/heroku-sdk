import {
  afterEach, describe, expect, it, vi,
} from 'vitest'

import {basicAuthorization} from './basic-authorization.js'

describe('basicAuthorization', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('encodes a known value', () => {
    expect(basicAuthorization('user', 'pass')).toBe('Basic dXNlcjpwYXNz')
  })

  it.each([
    ['ascii', 'my-app', 'api-key-123'],
    ['an empty username', '', 'credential-token'],
    ['empty credentials', '', ''],
    ['non-ASCII', 'usér', 'pässwörd-日本-🔑'],
    ['a colon in the password', 'user', 'a:b:c'],
    ['a lone high surrogate', 'user', '\uD800'],
    ['a lone low surrogate mid-string', 'user', 'a\uDC00b'],
    ['a long password', 'user', 'x'.repeat(100_000)],
  ])('matches Buffer\'s UTF-8 base64 for %s', (_, username, password) => {
    expect(basicAuthorization(username, password)).toBe(`Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`)
  })

  it('works without Buffer, as in a browser', () => {
    vi.stubGlobal('Buffer')
    expect(basicAuthorization('user', 'pass')).toBe('Basic dXNlcjpwYXNz')
  })
})
