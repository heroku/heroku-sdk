import {execFileSync} from 'node:child_process'
import {
  existsSync, mkdirSync, statSync, writeFileSync,
} from 'node:fs'
import path from 'node:path'
import {pathToFileURL} from 'node:url'
import {parseArgs} from 'node:util'
import {
  IndentationText,
  type ObjectLiteralElementLike,
  type ObjectLiteralExpression,
  Project,
  type ProjectOptions,
  QuoteKind,
  type SourceFile,
  SyntaxKind,
} from 'ts-morph'

export function makeProject(opts: ProjectOptions = {}): Project {
  return new Project({
    ...opts,
    manipulationSettings: {
      indentationText: IndentationText.TwoSpaces,
      insertSpaceAfterOpeningAndBeforeClosingNonemptyBraces: false,
      quoteKind: QuoteKind.Single,
      ...opts.manipulationSettings,
    },
  })
}

export type Names = {
  fnCamel: string
  fnKebab: string
  optsType: string
  resourceCamel: string
  resourceKebab: string
}

const CAMEL_RE = /^[a-z][a-zA-Z0-9]*$/

function camelToKebab(input: string): string {
  return input.replaceAll(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase()
}

function kebabToCamel(input: string): string {
  return input.replaceAll(/-([a-z])/g, (_, c: string) => c.toUpperCase())
}

function capitalize(input: string): string {
  return input.charAt(0).toUpperCase() + input.slice(1)
}

export function deriveNames(resource: string, fn: string): Names {
  if (!resource) {
    throw new Error('resource name is required')
  }

  if (!fn) {
    throw new Error('function name is required')
  }

  if (!CAMEL_RE.test(fn)) {
    throw new Error(`function name must be camelCase: ${fn}`)
  }

  const resourceCamel = resource.includes('-') ? kebabToCamel(resource) : resource
  if (!CAMEL_RE.test(resourceCamel)) {
    throw new Error(`resource name must be camelCase or kebab-case: ${resource}`)
  }

  const resourceKebab = camelToKebab(resourceCamel)

  return {
    fnCamel: fn,
    fnKebab: camelToKebab(fn),
    optsType: `${capitalize(fn)}Options`,
    resourceCamel,
    resourceKebab,
  }
}

export type ServiceName = 'data' | 'platform'
export type ParsedCli = {
  force: boolean
  functions: string[]
  help: boolean
  noLint: boolean
  resource: string
  service: ServiceName
}

const SERVICES: ReadonlySet<ServiceName> = new Set(['data', 'platform'])

export function parseCli(argv: string[]): ParsedCli {
  const {values} = parseArgs({
    allowPositionals: false,
    args: argv,
    options: {
      force: {default: false, type: 'boolean'},
      function: {multiple: true, type: 'string'},
      help: {short: 'h', type: 'boolean'},
      'no-lint': {default: false, type: 'boolean'},
      resource: {type: 'string'},
      service: {type: 'string'},
    },
    strict: true,
  })

  const help = Boolean(values.help)
  if (help) {
    return {
      force: false, functions: [], help: true, noLint: false, resource: '', service: 'platform',
    }
  }

  if (!values.service) throw new Error('missing required flag: --service')
  if (!SERVICES.has(values.service as ServiceName)) {
    throw new Error(`invalid --service: ${values.service} (expected: data | platform)`)
  }

  if (!values.resource) throw new Error('missing required flag: --resource')

  const functions = (values.function as string[] | undefined) ?? []
  if (functions.length === 0) throw new Error('missing required flag: --function (provide one or more)')

  return {
    force: Boolean(values.force),
    functions,
    help: false,
    noLint: Boolean(values['no-lint']),
    resource: values.resource,
    service: values.service as ServiceName,
  }
}

export function renderVerbFile(service: ServiceName, names: Names): string {
  return `import type {ResourceCtx} from '../../../core/extend-resource.js'

export type ${names.optsType} = {
  signal?: AbortSignal
}

export async function ${names.fnCamel}(
  ctx: Pick<ResourceCtx, '${service}'>,
  appIdentity: string,
  options: ${names.optsType} = {},
): Promise<unknown> {
  options.signal?.throwIfAborted()
  throw new Error('Not implemented: ${names.fnCamel}')
}
`
}

export function renderVerbTest(names: Names): string {
  return `import {describe as describeTest, expect, it} from 'vitest'

import {${names.fnCamel}} from './${names.fnKebab}.js'

describeTest('${names.fnCamel}', () => {
  it('throws until implemented', async () => {
    const ctx = {data: {} as never, platform: {} as never}
    await expect(${names.fnCamel}(ctx, 'app-1')).rejects.toThrow('Not implemented')
  })

  it('respects an already-aborted signal', async () => {
    const ctx = {data: {} as never, platform: {} as never}
    const controller = new AbortController()
    controller.abort()
    await expect(${names.fnCamel}(ctx, 'app-1', {signal: controller.signal})).rejects.toThrow()
  })
})
`
}

export function renderResourceIndex(service: ServiceName, names: Names): string {
  return `import {extendResource} from '../../../core/extend-resource.js'
import {${names.fnCamel}, type ${names.optsType}} from './${names.fnKebab}.js'

export {${names.fnCamel}, type ${names.optsType}} from './${names.fnKebab}.js'

export const ${names.resourceCamel}Extensions = extendResource('${service}', '${names.resourceCamel}', ctx => ({
  ${names.fnCamel}: (appIdentity: string, options?: ${names.optsType}) =>
    ${names.fnCamel}(ctx, appIdentity, options),
}))
`
}

export function renderResourceIndexTest(service: ServiceName, names: Names): string {
  return `import {describe, expect, it} from 'vitest'

import {${names.resourceCamel}Extensions} from './index.js'

describe('${names.resourceCamel} resource', () => {
  it('${names.resourceCamel}Extensions declares service: ${service}, resource: ${names.resourceCamel}', () => {
    expect(${names.resourceCamel}Extensions.service).toBe('${service}')
    expect(${names.resourceCamel}Extensions.resource).toBe('${names.resourceCamel}')
  })

  it('${names.resourceCamel}Extensions factory exposes the expected methods', () => {
    const ctx = {data: {} as never, platform: {} as never}
    const methods = ${names.resourceCamel}Extensions.factory(ctx)
    expect(typeof methods.${names.fnCamel}).toBe('function')
  })
})
`
}

export type InspectInput = {
  functions: string[]
  names: Names
  root: string
  service: ServiceName
}

export type InspectResult = {
  conflicts: string[]
  resourceExists: boolean
  resourceForm: 'dir'
}

export function inspectTarget(input: InspectInput): InspectResult {
  const {functions, names, root, service} = input
  const serviceDir = path.join(root, 'src', 'resources', service)
  const singleFilePath = path.join(serviceDir, `${names.resourceKebab}.ts`)
  const resourceDir = path.join(serviceDir, names.resourceKebab)

  if (existsSync(singleFilePath) && statSync(singleFilePath).isFile()) {
    throw new Error(`convert single-file form to directory form first: ${path.relative(root, singleFilePath)}`)
  }

  const resourceExists = existsSync(resourceDir) && statSync(resourceDir).isDirectory()

  const conflicts: string[] = []
  for (const fn of functions) {
    const fnNames = deriveNames(names.resourceCamel, fn)
    const verbPath = path.join(resourceDir, `${fnNames.fnKebab}.ts`)
    if (existsSync(verbPath)) {
      conflicts.push(path.relative(root, verbPath))
    }
  }

  return {conflicts, resourceExists, resourceForm: 'dir'}
}

export function wireExistingResourceIndex(
  sf: SourceFile,
  _service: ServiceName,
  names: Names,
): void {
  const moduleSpecifier = `./${names.fnKebab}.js`
  addNamedImport(sf, moduleSpecifier, {name: names.fnCamel})
  addNamedImport(sf, moduleSpecifier, {isTypeOnly: true, name: names.optsType})
  addBarrelReexport(sf, names, moduleSpecifier)
  addBundleProperty(sf, names)
}

function addNamedImport(
  sf: SourceFile,
  moduleSpecifier: string,
  spec: {isTypeOnly?: boolean; name: string},
): void {
  const existing = sf.getImportDeclaration(d => d.getModuleSpecifierValue() === moduleSpecifier)
  if (existing) {
    if (!existing.getNamedImports().some(n => n.getName() === spec.name)) {
      existing.addNamedImport(spec)
    }

    return
  }

  // eslint --fix sorts imports later, so insertion order doesn't matter.
  sf.addImportDeclaration({moduleSpecifier, namedImports: [spec]})
}

function addBarrelReexport(sf: SourceFile, names: Names, moduleSpecifier: string): void {
  const existing = sf.getExportDeclarations().find(d => d.getModuleSpecifierValue() === moduleSpecifier)
  if (existing) return

  const barrelDecls = sf.getExportDeclarations()
    .filter(d => d.getModuleSpecifierValue()?.startsWith('./'))
  // Find first sibling whose specifier sorts after ours.
  const insertBefore = barrelDecls.find(d => (d.getModuleSpecifierValue() ?? '') > moduleSpecifier)

  const structure = {
    moduleSpecifier,
    namedExports: [{name: names.fnCamel}, {isTypeOnly: true, name: names.optsType}],
  }

  if (insertBefore) {
    sf.insertExportDeclaration(insertBefore.getChildIndex(), structure)
    return
  }

  // Insert after the last barrel re-export, or at the end of the export block.
  const lastBarrel = barrelDecls.at(-1)
  if (lastBarrel) {
    sf.insertExportDeclaration(lastBarrel.getChildIndex() + 1, structure)
    return
  }

  sf.addExportDeclaration(structure)
}

function addBundleProperty(sf: SourceFile, names: Names): void {
  const callExpr = sf.getDescendantsOfKind(SyntaxKind.CallExpression)
    .find(c => c.getExpression().getText() === 'extendResource')
  if (!callExpr) {
    throw new Error('could not find extendResource(...) call in source file')
  }

  const factoryArg = callExpr.getArguments()[2]
  if (!factoryArg) {
    throw new Error('extendResource call missing factory argument')
  }

  const arrow = factoryArg.asKindOrThrow(SyntaxKind.ArrowFunction)
  const body = arrow.getBody()

  let objLit: ObjectLiteralExpression
  if (body.getKind() === SyntaxKind.ObjectLiteralExpression) {
    objLit = body.asKindOrThrow(SyntaxKind.ObjectLiteralExpression)
  } else if (body.getKind() === SyntaxKind.ParenthesizedExpression) {
    objLit = body.asKindOrThrow(SyntaxKind.ParenthesizedExpression)
      .getExpression()
      .asKindOrThrow(SyntaxKind.ObjectLiteralExpression)
  } else {
    throw new Error('expected `ctx => ({...})` factory body')
  }

  const propName = names.fnCamel
  if (objLit.getProperty(propName)) return

  const initializer
    = `(appIdentity: string, options?: ${names.optsType}) => `
    + `${names.fnCamel}(ctx, appIdentity, options)`

  const properties = objLit.getProperties()
  const insertAt = properties.findIndex(p => {
    const name = getPropertyName(p)
    return name !== undefined && name > propName
  })

  const index = insertAt === -1 ? properties.length : insertAt
  objLit.insertPropertyAssignment(index, {initializer, name: propName})
}

function getPropertyName(p: ObjectLiteralElementLike): string | undefined {
  if (p.isKind(SyntaxKind.PropertyAssignment) || p.isKind(SyntaxKind.ShorthandPropertyAssignment)) {
    return p.getName()
  }

  return undefined
}

export function wireExtensionsBarrel(
  sf: SourceFile,
  service: ServiceName,
  names: Names,
): void {
  const exportName = `${names.resourceCamel}Extensions`
  const moduleSpecifier = `../${service}/${names.resourceKebab}/index.js`

  const existing = sf.getExportDeclarations().find(d => {
    const named = d.getNamedExports().map(n => n.getName())
    return named.includes(exportName)
  })
  if (existing) return

  // Best-effort alphabetical insertion; eslint --fix sorts exports later.
  const decls = sf.getExportDeclarations()
  const insertBefore = decls.find(d => {
    const first = d.getNamedExports()[0]?.getName() ?? ''
    return first > exportName
  })

  const structure = {
    moduleSpecifier,
    namedExports: [{name: exportName}],
  }

  if (insertBefore) {
    sf.insertExportDeclaration(insertBefore.getChildIndex(), structure)
    return
  }

  sf.addExportDeclaration(structure)
}

const USAGE = `Usage: create-resource --service <platform|data> --resource <name> --function <name> [--function <name>...] [--force]

Required:
  --service   platform | data
  --resource  resource name (camelCase or kebab-case)
  --function  function name in camelCase (repeatable)

Optional:
  --force     overwrite existing verb files
  --no-lint   skip eslint --fix on generated files
  -h, --help  show usage
`

type WriteAction = {action: 'create' | 'overwrite'; contents: string; path: string}

export async function main(argv: string[], root: string = process.cwd()): Promise<number> {
  let cli: ParsedCli
  try {
    cli = parseCli(argv)
  } catch (error) {
    process.stderr.write(`${(error as Error).message}\n\n${USAGE}`)
    return 1
  }

  if (cli.help) {
    process.stdout.write(USAGE)
    return 0
  }

  const resourceNames = deriveNames(cli.resource, cli.functions[0])
  let inspection
  try {
    inspection = inspectTarget({
      functions: cli.functions,
      names: resourceNames,
      root,
      service: cli.service,
    })
  } catch (error) {
    process.stderr.write(`error: ${(error as Error).message}\n`)
    return 1
  }

  if (inspection.conflicts.length > 0 && !cli.force) {
    process.stderr.write(`error: target file(s) already exist (use --force to overwrite):\n  - ${inspection.conflicts.join('\n  - ')}\n`)
    return 1
  }

  const writes: WriteAction[] = []
  const resourceDir = path.join(root, 'src', 'resources', cli.service, resourceNames.resourceKebab)

  for (const fn of cli.functions) {
    const fnNames = deriveNames(cli.resource, fn)
    const verbPath = path.join(resourceDir, `${fnNames.fnKebab}.ts`)
    const verbTestPath = path.join(resourceDir, `${fnNames.fnKebab}.test.ts`)
    const exists = inspection.conflicts.includes(path.relative(root, verbPath))
    writes.push(
      {
        action: exists ? 'overwrite' : 'create',
        contents: renderVerbFile(cli.service, fnNames),
        path: verbPath,
      },
      {
        action: exists ? 'overwrite' : 'create',
        contents: renderVerbTest(fnNames),
        path: verbTestPath,
      },
    )
  }

  if (!inspection.resourceExists) {
    writes.push(
      {
        action: 'create',
        contents: renderResourceIndex(cli.service, resourceNames),
        path: path.join(resourceDir, 'index.ts'),
      },
      {
        action: 'create',
        contents: renderResourceIndexTest(cli.service, resourceNames),
        path: path.join(resourceDir, 'index.test.ts'),
      },
    )
  }

  // Apply file writes.
  mkdirSync(resourceDir, {recursive: true})
  for (const w of writes) {
    writeFileSync(w.path, w.contents)
  }

  // ts-morph edits to existing files.
  const morphFiles: string[] = []
  if (inspection.resourceExists) {
    const indexPath = path.join(resourceDir, 'index.ts')
    const project = makeProject({skipFileDependencyResolution: true})
    const sf = project.addSourceFileAtPath(indexPath)
    for (const fn of cli.functions) {
      wireExistingResourceIndex(sf, cli.service, deriveNames(cli.resource, fn))
    }

    sf.saveSync()
    morphFiles.push(indexPath)
  } else {
    const barrelPath = path.join(root, 'src', 'resources', 'extensions', `${cli.service}.ts`)
    const project = makeProject({skipFileDependencyResolution: true})
    const sf = project.addSourceFileAtPath(barrelPath)
    wireExtensionsBarrel(sf, cli.service, resourceNames)
    sf.saveSync()
    morphFiles.push(barrelPath)
  }

  // Lint touched files (non-fatal).
  const skipLint = cli.noLint || process.env.CREATE_RESOURCE_NO_LINT === '1'
  if (!skipLint) {
    const lintTargets = [...writes.map(w => w.path), ...morphFiles]
    try {
      execFileSync('npx', ['eslint', '--fix', ...lintTargets], {cwd: root, stdio: 'inherit'})
    } catch {
      process.stderr.write('warning: eslint --fix reported issues (files left in place)\n')
    }
  }

  // Summary.
  process.stdout.write('\nCreated/updated files:\n')
  for (const w of writes) {
    process.stdout.write(`  ${w.action === 'create' ? '+' : '~'} ${path.relative(root, w.path)}\n`)
  }

  for (const f of morphFiles) {
    process.stdout.write(`  ~ ${path.relative(root, f)}\n`)
  }

  process.stdout.write('\nNext: implement each function — they currently throw "Not implemented".\n')
  return 0
}

const isMain = import.meta.url === pathToFileURL(process.argv[1] ?? '').href
if (isMain) {
  // eslint-disable-next-line unicorn/prefer-top-level-await
  main(process.argv.slice(2))
    .then(code => {
      // eslint-disable-next-line n/no-process-exit, unicorn/no-process-exit
      process.exit(code)
    })
    .catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err)
      process.stderr.write(`fatal: ${message}\n`)
      // eslint-disable-next-line n/no-process-exit, unicorn/no-process-exit
      process.exit(1)
    })
}
