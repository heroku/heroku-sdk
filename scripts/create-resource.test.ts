import {
  mkdirSync, mkdtempSync, rmSync, writeFileSync,
} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {SyntaxKind} from 'ts-morph'
import {describe, expect, it} from 'vitest'

import {
  deriveNames,
  inspectTarget,
  makeProject,
  parseCli,
  renderResourceIndex,
  renderResourceIndexTest,
  renderVerbFile,
  renderVerbTest,
  wireExistingResourceIndex,
  wireExtensionsBarrel,
} from './create-resource.js'

function makeFixture(): string {
  return mkdtempSync(join(tmpdir(), 'create-resource-'))
}

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
      '--service',
      'platform',
      '--resource',
      'app',
      '--function',
      'describe',
      '--function',
      'listReleases',
    ])
    expect(result.functions).toEqual(['describe', 'listReleases'])
  })

  it('accepts --force as a boolean flag', () => {
    const result = parseCli([
      '--service',
      'platform',
      '--resource',
      'app',
      '--function',
      'describe',
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
      parseCli(['--service', 'billing', '--resource', 'app', '--function', 'describe'])).toThrow(/service/i)
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
      parseCli(['--service', 'platform', '--resource', 'app', '--function', 'd', '--bogus'])).toThrow()
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

describe('inspectTarget', () => {
  it('reports a brand-new resource when the resource directory does not exist', () => {
    const root = makeFixture()
    try {
      mkdirSync(join(root, 'src/resources/platform'), {recursive: true})
      const result = inspectTarget({
        functions: ['describe'],
        names: deriveNames('release', 'describe'),
        root,
        service: 'platform',
      })
      expect(result).toEqual({conflicts: [], resourceExists: false, resourceForm: 'dir'})
    } finally {
      rmSync(root, {force: true, recursive: true})
    }
  })

  it('reports an existing directory-form resource', () => {
    const root = makeFixture()
    try {
      mkdirSync(join(root, 'src/resources/platform/app'), {recursive: true})
      writeFileSync(join(root, 'src/resources/platform/app/index.ts'), '')
      const result = inspectTarget({
        functions: ['describe'],
        names: deriveNames('app', 'describe'),
        root,
        service: 'platform',
      })
      expect(result).toEqual({conflicts: [], resourceExists: true, resourceForm: 'dir'})
    } finally {
      rmSync(root, {force: true, recursive: true})
    }
  })

  it('detects a single-file resource and refuses to proceed', () => {
    const root = makeFixture()
    try {
      mkdirSync(join(root, 'src/resources/data'), {recursive: true})
      writeFileSync(join(root, 'src/resources/data/maintenance.ts'), '')
      expect(() =>
        inspectTarget({
          functions: ['info'],
          names: deriveNames('maintenance', 'info'),
          root,
          service: 'data',
        })).toThrow(/single-file form/)
    } finally {
      rmSync(root, {force: true, recursive: true})
    }
  })

  it('lists conflicts for verb files that already exist', () => {
    const root = makeFixture()
    try {
      mkdirSync(join(root, 'src/resources/platform/app'), {recursive: true})
      writeFileSync(join(root, 'src/resources/platform/app/index.ts'), '')
      writeFileSync(join(root, 'src/resources/platform/app/describe.ts'), '')
      const result = inspectTarget({
        functions: ['describe', 'listReleases'],
        names: deriveNames('app', 'describe'),
        root,
        service: 'platform',
      })
      expect(result.conflicts).toEqual(['src/resources/platform/app/describe.ts'])
    } finally {
      rmSync(root, {force: true, recursive: true})
    }
  })
})

const SAMPLE_INDEX = `import {extendResource} from '../../../core/extend-resource.js'
import {describe} from './describe.js'

export {describe, type DescribeOptions} from './describe.js'

export const appExtensions = extendResource('platform', 'app', ctx => ({
  describe: (appIdentity: string, options?: DescribeOptions) =>
    describe(ctx, appIdentity, options),
}))
`

function loadIndex(text: string) {
  const project = makeProject({useInMemoryFileSystem: true})
  return project.createSourceFile('index.ts', text)
}

describe('wireExistingResourceIndex', () => {
  it('adds an import for the new verb file', () => {
    const sf = loadIndex(SAMPLE_INDEX)
    wireExistingResourceIndex(sf, 'platform', deriveNames('app', 'listReleases'))
    expect(sf.getFullText()).toContain("import {listReleases} from './list-releases.js'")
  })

  it('adds a re-export for the new verb file in alphabetical order', () => {
    const sf = loadIndex(SAMPLE_INDEX)
    wireExistingResourceIndex(sf, 'platform', deriveNames('app', 'listReleases'))
    const exports = sf.getExportDeclarations()
      .map(d => d.getModuleSpecifierValue())
      .filter(Boolean)
    expect(exports).toEqual(['./describe.js', './list-releases.js'])
  })

  it('adds the new method to the extendResource factory in alphabetical order', () => {
    const sf = loadIndex(SAMPLE_INDEX)
    wireExistingResourceIndex(sf, 'platform', deriveNames('app', 'listReleases'))
    const text = sf.getFullText()
    // describe should still come before listReleases
    expect(text.indexOf('describe:')).toBeLessThan(text.indexOf('listReleases:'))
    expect(text).toContain('listReleases: (appIdentity: string, options?: ListReleasesOptions) =>')
  })

  it('inserts a method before alphabetically-greater siblings', () => {
    const sf = loadIndex(SAMPLE_INDEX)
    wireExistingResourceIndex(sf, 'platform', deriveNames('app', 'archive'))
    const text = sf.getFullText()
    expect(text.indexOf('archive:')).toBeLessThan(text.indexOf('describe:'))
  })

  it('throws if the file does not contain an extendResource call', () => {
    const sf = loadIndex(`export const x = 1
`)
    expect(() => wireExistingResourceIndex(sf, 'platform', deriveNames('app', 'describe'))).toThrow(/extendResource/)
  })

  it('skips when the function is already wired', () => {
    const sf = loadIndex(SAMPLE_INDEX)
    wireExistingResourceIndex(sf, 'platform', deriveNames('app', 'describe'))
    const exports = sf.getExportDeclarations().filter(d => d.getModuleSpecifierValue() === './describe.js')
    expect(exports.length).toBe(1)
    const imports = sf.getImportDeclarations().filter(d => d.getModuleSpecifierValue() === './describe.js')
    expect(imports.length).toBe(1)
    const callExpr = sf.getDescendantsOfKind(SyntaxKind.CallExpression)
      .find(c => c.getExpression().getText() === 'extendResource')!
    const arrow = callExpr.getArguments()[2].asKindOrThrow(SyntaxKind.ArrowFunction)
    const objLit = arrow.getBody()
      .asKindOrThrow(SyntaxKind.ParenthesizedExpression)
      .getExpression()
      .asKindOrThrow(SyntaxKind.ObjectLiteralExpression)
    const describeProps = objLit.getProperties().filter(p => p.isKind(SyntaxKind.PropertyAssignment) && p.getName() === 'describe')
    expect(describeProps.length).toBe(1)
  })

  it('inserts alphabetically among shorthand property siblings', () => {
    const project = makeProject({useInMemoryFileSystem: true})
    const sf = project.createSourceFile('shorthand-index.ts', `import {extendResource} from '../../../core/extend-resource.js'
import {formatPlanPriceLabel} from './pricing.js'
import {priceForPlan} from './pricing.js'

export const sampleExtensions = extendResource('platform', 'sample', ctx => ({
  formatPlanPriceLabel,
  priceForPlan,
}))
`)
    wireExistingResourceIndex(sf, 'platform', deriveNames('sample', 'patch'))
    const text = sf.getFullText()
    // patch should sort between formatPlanPriceLabel and priceForPlan in the bundle body.
    // Match the shorthand siblings as they appear in the bundle (with trailing comma) so we
    // don't accidentally match their import declarations above the bundle.
    expect(text.indexOf('formatPlanPriceLabel,')).toBeLessThan(text.indexOf('patch:'))
    expect(text.indexOf('patch:')).toBeLessThan(text.indexOf('priceForPlan,'))
  })
})

const SAMPLE_BARREL = `export {addOnExtensions} from '../platform/add-on/index.js'
export {appExtensions} from '../platform/app/index.js'
`

describe('wireExtensionsBarrel', () => {
  it('inserts a new export in alphabetical order', () => {
    const project = makeProject({useInMemoryFileSystem: true})
    const sf = project.createSourceFile('platform.ts', SAMPLE_BARREL)
    wireExtensionsBarrel(sf, 'platform', deriveNames('release', 'describe'))
    const out = sf.getFullText()
    expect(out).toContain("export {releaseExtensions} from '../platform/release/index.js'")
    expect(out.indexOf('appExtensions')).toBeLessThan(out.indexOf('releaseExtensions'))
  })

  it('inserts before alphabetically-greater siblings', () => {
    const project = makeProject({useInMemoryFileSystem: true})
    const sf = project.createSourceFile('platform.ts', SAMPLE_BARREL)
    wireExtensionsBarrel(sf, 'platform', deriveNames('account', 'info'))
    const out = sf.getFullText()
    expect(out.indexOf('accountExtensions')).toBeLessThan(out.indexOf('addOnExtensions'))
  })

  it('skips when the resource is already exported', () => {
    const project = makeProject({useInMemoryFileSystem: true})
    const sf = project.createSourceFile('platform.ts', SAMPLE_BARREL)
    wireExtensionsBarrel(sf, 'platform', deriveNames('app', 'describe'))
    const matches = sf.getFullText().match(/appExtensions/g) ?? []
    expect(matches.length).toBe(1)
  })
})
