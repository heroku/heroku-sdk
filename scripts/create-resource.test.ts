import {describe, expect, it} from 'vitest'

import {
  deriveNames,
  parseCli,
  renderResourceIndex,
  renderResourceIndexTest,
  renderVerbFile,
  renderVerbTest,
} from './create-resource.js'

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

describe('renderVerbFile', () => {
  it('renders the verb file template for a platform resource', () => {
    const names = deriveNames('release', 'describe')
    const out = renderVerbFile('platform', names)
    expect(out).toBe(`import type {ResourceCtx} from '../../../core/extend-resource.js'

export type DescribeOptions = {
  signal?: AbortSignal
}

export async function describe(
  ctx: Pick<ResourceCtx, 'platform'>,
  appIdentity: string,
  options: DescribeOptions = {},
): Promise<unknown> {
  options.signal?.throwIfAborted()
  throw new Error('Not implemented: describe')
}
`)
  })

  it('uses the data service in the ctx pick when service is data', () => {
    const names = deriveNames('database', 'describe')
    expect(renderVerbFile('data', names)).toContain("Pick<ResourceCtx, 'data'>")
  })
})

describe('renderVerbTest', () => {
  it('renders the verb test template', () => {
    const names = deriveNames('release', 'describe')
    expect(renderVerbTest(names)).toBe(`import {describe as describeTest, expect, it} from 'vitest'

import {describe} from './describe.js'

describeTest('describe', () => {
  it('throws until implemented', async () => {
    const ctx = {data: {} as never, platform: {} as never}
    await expect(describe(ctx, 'app-1')).rejects.toThrow('Not implemented')
  })

  it('respects an already-aborted signal', async () => {
    const ctx = {data: {} as never, platform: {} as never}
    const controller = new AbortController()
    controller.abort()
    await expect(describe(ctx, 'app-1', {signal: controller.signal})).rejects.toThrow()
  })
})
`)
  })
})

describe('renderResourceIndex', () => {
  it('renders the resource index template', () => {
    const names = deriveNames('release', 'describe')
    expect(renderResourceIndex('platform', names)).toBe(`import {extendResource} from '../../../core/extend-resource.js'
import {describe} from './describe.js'

export {describe, type DescribeOptions} from './describe.js'

export const releaseExtensions = extendResource('platform', 'release', ctx => ({
  describe: (appIdentity: string, options?: DescribeOptions) =>
    describe(ctx, appIdentity, options),
}))
`)
  })
})

describe('renderResourceIndexTest', () => {
  it('renders the resource index test template', () => {
    const names = deriveNames('release', 'describe')
    expect(renderResourceIndexTest('platform', names)).toBe(`import {describe, expect, it} from 'vitest'

import {releaseExtensions} from './index.js'

describe('release resource', () => {
  it('releaseExtensions declares service: platform, resource: release', () => {
    expect(releaseExtensions.service).toBe('platform')
    expect(releaseExtensions.resource).toBe('release')
  })

  it('releaseExtensions factory exposes the expected methods', () => {
    const ctx = {data: {} as never, platform: {} as never}
    const methods = releaseExtensions.factory(ctx)
    expect(typeof methods.describe).toBe('function')
  })
})
`)
  })
})
