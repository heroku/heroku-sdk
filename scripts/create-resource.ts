import {existsSync, statSync} from 'node:fs'
import path from 'node:path'
import {parseArgs} from 'node:util'

import {
  IndentationText,
  type ObjectLiteralElementLike,
  type ObjectLiteralExpression,
  QuoteKind,
  type SourceFile,
  SyntaxKind,
} from 'ts-morph'

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
      resource: {type: 'string'},
      service: {type: 'string'},
    },
    strict: true,
  })

  const help = Boolean(values.help)
  if (help) {
    return {force: false, functions: [], help: true, resource: '', service: 'platform'}
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
import {${names.fnCamel}} from './${names.fnKebab}.js'

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
    throw new Error(
      `convert single-file form to directory form first: ${path.relative(root, singleFilePath)}`,
    )
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
  // Match the project's existing source style (single quotes, no spaces around braces, 2-space indent).
  sf.getProject().manipulationSettings.set({
    indentationText: IndentationText.TwoSpaces,
    insertSpaceAfterOpeningAndBeforeClosingNonemptyBraces: false,
    quoteKind: QuoteKind.Single,
  })

  const moduleSpecifier = `./${names.fnKebab}.js`
  addNamedImport(sf, names.fnCamel, moduleSpecifier)
  addBarrelReexport(sf, names, moduleSpecifier)
  addBundleProperty(sf, names)
}

function addNamedImport(sf: SourceFile, name: string, moduleSpecifier: string): void {
  const existing = sf.getImportDeclaration(d => d.getModuleSpecifierValue() === moduleSpecifier)
  if (existing) {
    if (!existing.getNamedImports().some(n => n.getName() === name)) {
      existing.addNamedImport(name)
    }

    return
  }

  // eslint --fix sorts imports later, so insertion order doesn't matter.
  sf.addImportDeclaration({moduleSpecifier, namedImports: [name]})
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
