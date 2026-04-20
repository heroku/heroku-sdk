import { describe, it, expect } from 'vitest'
import { interpolatePath } from './interpolate-path.js'

describe('interpolatePath', () => {
  it('replaces a single placeholder', () => {
    expect(interpolatePath('/apps/{appIdentity}', ['my-app'])).toBe('/apps/my-app')
  })

  it('replaces multiple placeholders in order', () => {
    expect(
      interpolatePath('/apps/{appIdentity}/dynos/{dynoIdentity}', ['my-app', 'web.1']),
    ).toBe('/apps/my-app/dynos/web.1')
  })

  it('encodes special characters', () => {
    expect(interpolatePath('/apps/{id}', ['my app/test'])).toBe('/apps/my%20app%2Ftest')
  })

  it('throws when fewer params than placeholders', () => {
    expect(() => interpolatePath('/apps/{id}/dynos/{did}', ['my-app'])).toThrow(
      'Missing path parameter at index 1',
    )
  })

  it('returns path unchanged when no placeholders', () => {
    expect(interpolatePath('/apps', [])).toBe('/apps')
  })

  it('handles empty string params', () => {
    expect(interpolatePath('/apps/{id}', [''])).toBe('/apps/')
  })
})
