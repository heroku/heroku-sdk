import type {HerokuApiClientOptions} from '@heroku/heroku-fetch'
import type {Dyno} from '@heroku/types/3.sdk'

import {HerokuApiClient} from '@heroku/heroku-fetch'

const ACCEPT_EXTENDED = 'application/vnd.heroku+json; version=3.sdk'

/**
 * Operational detail the platform attaches to each dyno only when the
 * `?extended=true` query is used with the `version=3.sdk` Accept
 * variant. Every field is nullable — the platform omits values it
 * cannot resolve for a given dyno (e.g. a `run` dyno has no `route`).
 */
export type DynoExtendedFields = {
  az: string | null
  execution_plane: string | null
  fleet: string | null
  instance: string | null
  ip: string | null
  port: number | null
  region: string | null
  route: string | null
}

/**
 * A {@link Dyno} plus the optional {@link DynoExtendedFields} block
 * returned by {@link listExtended}. `extended` is absent unless the
 * request was made with sudo privileges against a supporting stack.
 */
export type DynoExtended = Dyno & {
  extended?: DynoExtendedFields
}

export type ListExtendedOptions = {
  /**
   * Options forwarded to the raw `HerokuApiClient`. The route registry
   * has no entry for `GET /apps/{app}/dynos?extended=true`, so this
   * call is issued via a bare client (like the exec-inside path in
   * {@link runDyno}).
   */
  clientOptions?: HerokuApiClientOptions
  signal?: AbortSignal
}

/**
 * List an app's dynos with the extended operational detail block.
 *
 * Issues `GET /apps/{app}/dynos?extended=true` with
 * `Accept: version=3.sdk` via a bare `HerokuApiClient`, because the
 * routes registry has no entry for the `extended` query variant. The
 * `extended` block is only populated for callers with sudo
 * privileges; without them the platform returns ordinary dynos and
 * `extended` is absent.
 *
 * Unlike the routes client, this does not auto-paginate — it issues a
 * single GET, matching the historical CLI behavior.
 */
export async function listExtended(
  appIdentity: string,
  options: ListExtendedOptions = {},
): Promise<DynoExtended[]> {
  options.signal?.throwIfAborted()

  const apiClient = new HerokuApiClient({
    ...options.clientOptions,
    service: 'platform',
  })
  const path = `/apps/${encodeURIComponent(appIdentity)}/dynos?extended=true`
  const response = await apiClient.get(path, {
    headers: {Accept: ACCEPT_EXTENDED},
    signal: options.signal,
  })
  return (await response.json()) as DynoExtended[]
}
