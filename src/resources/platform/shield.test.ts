import {describe, expect, it} from 'vitest'

import {privateToShield, shieldToPrivate} from './shield.js'

describe('shield utilities', () => {
  describe('shieldToPrivate', () => {
    it('converts Shield- prefix to Private-', () => {
      expect(shieldToPrivate('Shield-M')).toBe('Private-M')
      expect(shieldToPrivate('Shield-L')).toBe('Private-L')
    })

    it('is a no-op for non-shield sizes', () => {
      expect(shieldToPrivate('Standard-1X')).toBe('Standard-1X')
      expect(shieldToPrivate('Private-M')).toBe('Private-M')
    })
  })

  describe('privateToShield', () => {
    it('converts Private- prefix to Shield-', () => {
      expect(privateToShield('Private-M')).toBe('Shield-M')
      expect(privateToShield('Private-L')).toBe('Shield-L')
    })

    it('is a no-op for non-private sizes', () => {
      expect(privateToShield('Standard-1X')).toBe('Standard-1X')
      expect(privateToShield('Shield-M')).toBe('Shield-M')
    })
  })
})
