/**
 * An environment variable's value, or `undefined` where there is no `process` (browsers,
 * workers). The SDK reads env vars only for optional overrides, so callers fall back to
 * their defaults outside Node.
 */
export function readEnv(name: string): string | undefined {
  return (globalThis as {process?: {env?: Record<string, string | undefined>}}).process?.env?.[name]
}
