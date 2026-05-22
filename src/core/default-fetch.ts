import createDebug from 'debug'

const debug = createDebug('heroku:sdk:default-fetch')

const DEFAULT_USER_AGENT = '@heroku/sdk'

// The SDK doesn't depend on @types/node so it can ship browser-friendly
// types. Reach for the Node globals only via a narrowly-typed helper
// that returns undefined in the browser.
type NodeProcess = {
  env?: Record<string, string | undefined>
  versions?: {node?: string}
}

function getNodeProcess(): NodeProcess | undefined {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const proc = (globalThis as any).process as NodeProcess | undefined
  return proc?.versions?.node ? proc : undefined
}

/**
 * Build the default `fetch` that the SDK uses for off-platform calls
 * (logplex streams, busl release outputs, etc).
 *
 * In a browser, returns the native `fetch` unchanged — the browser
 * handles `User-Agent` itself and routes through its own proxy stack.
 *
 * In Node, wraps `fetch` to:
 *   - set a `User-Agent` header (Node's fetch does not set one
 *     automatically; many CDNs and proxies require it)
 *   - route through an `undici.EnvHttpProxyAgent`, which honors the
 *     `HTTP_PROXY` / `HTTPS_PROXY` / `NO_PROXY` env vars
 *
 * If `undici` isn't loadable (e.g. the consumer is on Deno or Bun
 * where `process.versions.node` is set but undici isn't there), the
 * function falls back to native `fetch`. Those runtimes have their
 * own proxy handling and may reject the `dispatcher` option anyway.
 *
 * Override the User-Agent with the `HEROKU_DEBUG_USER_AGENT` env var.
 */
export async function buildDefaultFetch(): Promise<typeof fetch> {
  const proc = getNodeProcess()
  if (!proc) {
    debug('non-node runtime; using native fetch')
    return fetch
  }

  let dispatcher: unknown
  try {
    // @ts-expect-error: undici is a Node built-in (no static types in
    // the SDK's dep tree); the dynamic import keeps it out of browser
    // bundles via tree-shaking.
    // eslint-disable-next-line import/no-unresolved
    const {EnvHttpProxyAgent} = await import('undici')
    dispatcher = new EnvHttpProxyAgent()
    debug('using undici EnvHttpProxyAgent for proxy support')
  } catch (error) {
    debug('undici not available; falling back to native fetch (%o)', error)
    return fetch
  }

  const userAgent = proc.env?.HEROKU_DEBUG_USER_AGENT || DEFAULT_USER_AGENT

  return (input, init) => {
    const headers = new Headers(init?.headers)
    if (!headers.has('User-Agent')) headers.set('User-Agent', userAgent)
    return fetch(input, {...init, dispatcher, headers} as never)
  }
}
