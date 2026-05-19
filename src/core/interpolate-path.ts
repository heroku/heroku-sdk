export const PLACEHOLDER = /\{[^}]+\}/g

export function countPlaceholders(template: string): number {
  return template.match(PLACEHOLDER)?.length ?? 0
}

export function interpolatePath(template: string, params: string[]): string {
  let i = 0
  return template.replaceAll(PLACEHOLDER, () => {
    if (i >= params.length) {
      throw new Error(`Missing path parameter at index ${i} for template: ${template}`)
    }

    return encodeURIComponent(params[i++])
  })
}
