import {describe, expect, it} from 'vitest'

import {basicAuthorization} from './basic-authorization.js'

describe('basicAuthorization', () => {
  it.each([
    ['ascii', 'my-app', 'api-key-123'],
    ['an empty username', '', 'credential-token'],
    ['empty credentials', '', ''],
    ['non-ASCII', 'usér', 'pässwörd-日本-🔑'],
    ['a colon in the password', 'user', 'a:b:c'],
  ])('matches Buffer\'s UTF-8 base64 for %s', (_, username, password) => {
    expect(basicAuthorization(username, password)).toBe(`Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`)
  })
})
