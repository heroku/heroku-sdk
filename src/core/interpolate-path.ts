const PLACEHOLDER = /\{[^}]+\}/g

export function interpolatePath(template: string, params: string[]): string {
  let i = 0
  return template.replaceAll(PLACEHOLDER, () => {
    if (i >= params.length) {
      throw new Error(`Missing path parameter at index ${i} for template: ${template}`)
    }

    return encodeURIComponent(params[i++])
  })
}
