/**
 * An HTTP Basic `Authorization` header value for `username:password`, UTF-8 encoded.
 * Uses `TextEncoder` and `btoa` rather than Node's `Buffer`, so it works in browsers too.
 */
export function basicAuthorization(username: string, password: string): string {
  const bytes = new TextEncoder().encode(`${username}:${password}`)
  // btoa is the base64 encoder available in both browsers and Node (Buffer is Node-only).
  // eslint-disable-next-line no-restricted-globals
  return `Basic ${btoa(Array.from(bytes, byte => String.fromCodePoint(byte)).join(''))}`
}
