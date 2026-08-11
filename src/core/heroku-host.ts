/// <reference types="node" />

/**
 * Derive a platform API base URL from the HEROKU_HOST environment variable,
 * mirroring the CLI's `@heroku-cli/command` `vars` API-URL semantics so
 * SDK-based commands hit the same host the CLI would:
 *
 *   - unset            → `undefined` (heroku-fetch falls back to its production
 *                        `SERVICE_CONFIGS.platform` default)
 *   - starts with http → used verbatim as the API URL
 *   - bare host        → `https://api.${HEROKU_HOST}`
 *
 * Returning `undefined` when HEROKU_HOST is unset lets callers leave the
 * service default in place.
 */
export function platformBaseUrlFromEnv(host = process.env.HEROKU_HOST): string | undefined {
  if (!host) return undefined
  if (host.startsWith('http')) return host
  return `https://api.${host}`
}
