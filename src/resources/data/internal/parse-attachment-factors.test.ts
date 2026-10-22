import {
  describe, expect, it,
} from 'vitest'

import {parseAttachmentFactors} from './parse-attachment-factors.js'

describe('parseAttachmentFactors', () => {
  it('returns an empty object when the namespace is blank', () => {
    expect(parseAttachmentFactors()).toEqual({})
    expect(parseAttachmentFactors(null)).toEqual({})
    expect(parseAttachmentFactors('')).toEqual({})
    expect(parseAttachmentFactors('   ')).toEqual({})
  })

  it('parses a full multi-factor namespace', () => {
    expect(parseAttachmentFactors('role:analyst|pool:analytics|proxy:false')).toEqual({
      pool: 'analytics',
      proxy: false,
      role: 'analyst',
    })
  })

  it('parses a single role factor', () => {
    const result = parseAttachmentFactors('role:analyst')

    expect(result).toEqual({role: 'analyst'})
    expect(result).not.toHaveProperty('pool')
    expect(result).not.toHaveProperty('proxy')
  })

  it('parses a single pool factor', () => {
    const result = parseAttachmentFactors('pool:analytics')

    expect(result).toEqual({pool: 'analytics'})
    expect(result).not.toHaveProperty('role')
    expect(result).not.toHaveProperty('proxy')
  })

  it('treats proxy as true only when the value is exactly true', () => {
    expect(parseAttachmentFactors('proxy:false')).toEqual({proxy: false})
    expect(parseAttachmentFactors('proxy:TRUE')).toEqual({proxy: false})
    expect(parseAttachmentFactors('proxy:true')).toEqual({proxy: true})
  })

  it('skips a factor when the colon delimiter is missing', () => {
    expect(parseAttachmentFactors('role:analyst|proxy|pool:analytics')).toEqual({
      pool: 'analytics',
      role: 'analyst',
    })
  })

  it('ignores unknown keys', () => {
    const result = parseAttachmentFactors('role:analyst|foo:bar|pool:analytics')

    expect(result).toEqual({
      pool: 'analytics',
      role: 'analyst',
    })
    expect(result).not.toHaveProperty('foo')
  })

  it('trims whitespace around factor keys and values', () => {
    expect(parseAttachmentFactors('  role  :  analyst  |  pool : analytics  |  proxy :  true  ')).toEqual({
      pool: 'analytics',
      proxy: true,
      role: 'analyst',
    })
  })

  it('returns an empty object for a legacy credential-prefixed namespace', () => {
    const result = parseAttachmentFactors('credential:analyst')

    expect(result).toEqual({})
    expect(result).not.toHaveProperty('credential')
  })

  it('uses the last occurrence when the same factor key appears more than once', () => {
    expect(parseAttachmentFactors('role:first|pool:leader|role:second')).toEqual({
      pool: 'leader',
      role: 'second',
    })
  })

  it('splits only on the first colon so values may contain additional colons', () => {
    expect(parseAttachmentFactors('role:user:with:colons|proxy:false|pool:analytics')).toEqual({
      pool: 'analytics',
      proxy: false,
      role: 'user:with:colons',
    })
  })
})
