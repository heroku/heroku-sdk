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
