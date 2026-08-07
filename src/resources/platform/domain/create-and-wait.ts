import type {Domain} from '@heroku/types/3.sdk'

import type {ResourceCtx} from '../../../core/extend-resource.js'
import type {CreateAndWaitOptions} from './types.js'

import {waitForReady} from './wait-for-ready.js'

/**
 * Create a domain with SNI endpoint resolution and optional waiting.
 *
 * Steps:
 * 1. If no explicit sniEndpoint option, list SNI endpoints on the app
 * 2. If multiple SNI endpoints, call resolveSniEndpoint callback
 * 3. Create the domain with SNI endpoint (defaults to null if not resolved)
 * 4. If wait: true, poll until domain reaches ready status
 */
export async function createAndWait(
  ctx: Pick<ResourceCtx, 'platform'>,
  appIdentity: string,
  hostname: string,
  options: CreateAndWaitOptions = {},
): Promise<Domain> {
  const {
    poller,
    resolveSniEndpoint,
    signal,
    sniEndpoint,
    timeoutMs,
    wait: shouldWait,
    waitIntervalMs,
  } = options

  signal?.throwIfAborted()

  const platform = signal ? ctx.platform.withOptions({signal}) : ctx.platform

  let resolvedSniEndpoint: null | string = null

  if (sniEndpoint) {
    // Explicit SNI endpoint provided
    resolvedSniEndpoint = sniEndpoint
  } else {
    // List SNI endpoints and resolve
    const sniEndpoints = await platform.sniEndpoint.list(appIdentity)

    if (sniEndpoints.length > 1) {
      const sniEndpointSelection = await resolveSniEndpoint?.(sniEndpoints)

      if (sniEndpointSelection) {
        resolvedSniEndpoint = sniEndpointSelection
      }
    }
  }

  // Create domain
  let domain = await platform.domain.create(appIdentity, {
    hostname,
    // eslint-disable-next-line camelcase
    sni_endpoint: resolvedSniEndpoint,
  })

  if (shouldWait && domain.status !== 'none') {
    const [readyDomain] = await waitForReady(ctx, appIdentity, {
      domain,
      poller,
      signal,
      timeoutMs,
      waitIntervalMs,
    })
    domain = readyDomain
  }

  return domain
}
