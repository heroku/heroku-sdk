import {describe, expect, it} from 'vitest'

import {deriveNames} from './create-resource.js'

describe('deriveNames', () => {
  it('derives names for a single-word camelCase resource and function', () => {
    expect(deriveNames('app', 'describe')).toEqual({
      fnCamel: 'describe',
      fnKebab: 'describe',
      optsType: 'DescribeOptions',
      resourceCamel: 'app',
      resourceKebab: 'app',
    })
  })

  it('converts a kebab-case resource input to camelCase', () => {
    expect(deriveNames('add-on', 'upgrade').resourceCamel).toBe('addOn')
    expect(deriveNames('add-on', 'upgrade').resourceKebab).toBe('add-on')
  })

  it('converts a camelCase resource input to kebab-case for filenames', () => {
    expect(deriveNames('postgresDatabase', 'listCredentials').resourceKebab).toBe('postgres-database')
    expect(deriveNames('postgresDatabase', 'listCredentials').resourceCamel).toBe('postgresDatabase')
  })

  it('derives kebab-case verb file names and TitleCase options type', () => {
    expect(deriveNames('app', 'listReleases')).toMatchObject({
      fnCamel: 'listReleases',
      fnKebab: 'list-releases',
      optsType: 'ListReleasesOptions',
    })
  })

  it('rejects an empty resource name', () => {
    expect(() => deriveNames('', 'foo')).toThrow(/resource/i)
  })

  it('rejects a function name that is not a valid camelCase identifier', () => {
    expect(() => deriveNames('app', '1foo')).toThrow(/function/i)
    expect(() => deriveNames('app', 'list-releases')).toThrow(/camelCase/i)
    expect(() => deriveNames('app', '')).toThrow(/function/i)
  })
})
