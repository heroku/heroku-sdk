export function shieldToPrivate(size: string): string {
  return size.replace(/^Shield-/, 'Private-')
}

export function privateToShield(size: string): string {
  return size.replace(/^Private-/, 'Shield-')
}
