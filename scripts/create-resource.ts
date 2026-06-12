import {parseArgs} from 'node:util'

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
