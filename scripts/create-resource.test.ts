import {describe, expect, it} from 'vitest'

import {deriveNames, parseCli} from './create-resource.js'

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

  it('rejects a resource name that is neither camelCase nor kebab-case', () => {
    expect(() => deriveNames('Foo', 'bar')).toThrow(/resource/i)
    expect(() => deriveNames('foo_bar', 'baz')).toThrow(/resource/i)
    expect(() => deriveNames('-foo', 'bar')).toThrow(/resource/i)
    expect(() => deriveNames('Add-On', 'bar')).toThrow(/resource/i)
  })
})

describe('parseCli', () => {
  it('parses required flags', () => {
    expect(parseCli(['--service', 'platform', '--resource', 'app', '--function', 'describe'])).toEqual({
      force: false,
      functions: ['describe'],
      help: false,
      resource: 'app',
      service: 'platform',
    })
  })

  it('accepts repeated --function flags', () => {
    const result = parseCli([
      '--service', 'platform',
      '--resource', 'app',
      '--function', 'describe',
      '--function', 'listReleases',
    ])
    expect(result.functions).toEqual(['describe', 'listReleases'])
  })

  it('accepts --force as a boolean flag', () => {
    const result = parseCli([
      '--service', 'platform',
      '--resource', 'app',
      '--function', 'describe',
      '--force',
    ])
    expect(result.force).toBe(true)
  })

  it('accepts -h and --help', () => {
    expect(parseCli(['--help']).help).toBe(true)
    expect(parseCli(['-h']).help).toBe(true)
  })

  it('rejects an invalid --service value', () => {
    expect(() =>
      parseCli(['--service', 'billing', '--resource', 'app', '--function', 'describe']),
    ).toThrow(/service/i)
  })

  it('rejects missing --service when not asking for help', () => {
    expect(() => parseCli(['--resource', 'app', '--function', 'describe'])).toThrow(/--service/)
  })

  it('rejects missing --resource', () => {
    expect(() => parseCli(['--service', 'platform', '--function', 'describe'])).toThrow(/--resource/)
  })

  it('rejects missing --function', () => {
    expect(() => parseCli(['--service', 'platform', '--resource', 'app'])).toThrow(/--function/)
  })

  it('rejects unknown flags', () => {
    expect(() =>
      parseCli(['--service', 'platform', '--resource', 'app', '--function', 'd', '--bogus']),
    ).toThrow()
  })
})
