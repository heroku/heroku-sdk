import type {SniEndpoint} from '@heroku/types/3.sdk'

import type {ResourceCtx} from '../../../core/extend-resource.js'
import type {SniCertificate} from './create-and-associate.js'

import {withSignal} from '../../../core/with-signal.js'

/**
 * Which of an app's SNI endpoints (SSL certificates) to select: by endpoint `name`, by a
 * `hostname` associated with it, or neither (`{}`) when the app has exactly one. Not both.
 */
export type SniEndpointSelector
  = | {hostname: string; name?: never}
  | {hostname?: never; name: string}
  | {hostname?: never; name?: never}

export type ResolveSniEndpointOptions = {
  signal?: AbortSignal
}

/** Thrown when no SNI endpoint on the app matches the selector. */
export class SniEndpointNotFoundError extends Error {
  public readonly id = 'not_found'
  public readonly statusCode = 404

  constructor(
    public readonly appIdentity: string,
    public readonly selector: SniEndpointSelector,
    message: string,
  ) {
    super(message)
    this.name = 'SniEndpointNotFoundError'
  }

  public get body() {
    return {id: this.id, message: this.message, resource: 'sni-endpoint'}
  }
}

/** Thrown when the selector names nothing and the app has more than one SNI endpoint. */
export class SniEndpointAmbiguousError extends Error {
  public readonly id = 'multiple_matches'
  public readonly statusCode = 422

  constructor(public readonly appIdentity: string, public readonly matches: SniEndpoint[]) {
    super(`${appIdentity} has ${matches.length} SSL certificates (${matches.map(e => e.name).join(', ')}); select one by name.`)
    this.name = 'SniEndpointAmbiguousError'
  }

  public get body() {
    return {id: this.id, matches: this.matches.map(({id, name}) => ({id, name})), message: this.message}
  }
}

/**
 * Resolve one of an app's SNI endpoints.
 *
 *   - `name`: fetched directly with `sniEndpoint.info`.
 *   - `hostname`: the app domain's `sni_endpoint`, then that endpoint.
 *   - neither: the app's only endpoint.
 *
 * API errors other than a 404 for the endpoint or domain, including a 404 for the app
 * itself, are rethrown as is.
 *
 * @throws `SniEndpointNotFoundError` when nothing matches: no endpoint by that name, the
 * hostname isn't a domain on the app or has no endpoint, or the app has no endpoints.
 * @throws `SniEndpointAmbiguousError` when neither is given and the app has several.
 * @throws `TypeError` when both `name` and `hostname` are given, or either is empty.
 */
export async function resolveSniEndpoint(
  ctx: Pick<ResourceCtx, 'platform'>,
  appIdentity: string,
  selector: SniEndpointSelector = {},
  options: ResolveSniEndpointOptions = {},
): Promise<SniEndpoint> {
  options.signal?.throwIfAborted()
  const {hostname, name} = selector
  if (hostname !== undefined && name !== undefined) {
    throw new TypeError('Select an SSL certificate by name or by hostname, not both.')
  }

  if (hostname === '' || name === '') {
    throw new TypeError(`An SSL certificate ${name === '' ? 'name' : 'hostname'} can't be empty.`)
  }

  const platform = withSignal(ctx.platform, options.signal)

  if (name !== undefined) {
    return rethrowNotFound(
      platform.sniEndpoint.info(appIdentity, name),
      () => new SniEndpointNotFoundError(appIdentity, selector, `Couldn't find an SSL certificate named ${name} on ${appIdentity}.`),
    )
  }

  if (hostname !== undefined) {
    const domain = await rethrowNotFound(
      platform.domain.info(appIdentity, hostname),
      () => new SniEndpointNotFoundError(appIdentity, selector, `${hostname} isn't a domain on ${appIdentity}.`),
    )
    const endpointIdentity = domain.sni_endpoint?.id ?? domain.sni_endpoint?.name
    if (!endpointIdentity) {
      throw new SniEndpointNotFoundError(appIdentity, selector, `${hostname} on ${appIdentity} isn't associated with an SSL certificate.`)
    }

    return rethrowNotFound(
      platform.sniEndpoint.info(appIdentity, endpointIdentity),
      () => new SniEndpointNotFoundError(appIdentity, selector, `Couldn't find the SSL certificate associated with ${hostname} on ${appIdentity}.`),
    )
  }

  const endpoints = await platform.sniEndpoint.list(appIdentity)
  if (endpoints.length === 0) {
    throw new SniEndpointNotFoundError(appIdentity, selector, `${appIdentity} has no SSL certificates.`)
  }

  if (endpoints.length > 1) throw new SniEndpointAmbiguousError(appIdentity, endpoints)
  return endpoints[0]
}

export type ResolveAndDeleteOptions = ResolveSniEndpointOptions & {
  /**
   * Runs once the endpoint is resolved, before it's deleted. Callers can confirm here;
   * a throw (or abort) prevents the delete.
   */
  beforeDelete?: (preview: {sniEndpoint: SniEndpoint}) => Promise<void> | void
}

/** Resolve an SNI endpoint (see `resolveSniEndpoint`) and delete it. @returns the deleted endpoint. */
export async function resolveAndDelete(
  ctx: Pick<ResourceCtx, 'platform'>,
  appIdentity: string,
  selector: SniEndpointSelector,
  options: ResolveAndDeleteOptions = {},
): Promise<SniEndpoint> {
  const sniEndpoint = await resolveSniEndpoint(ctx, appIdentity, selector, options)
  await options.beforeDelete?.({sniEndpoint})
  options.signal?.throwIfAborted()
  return withSignal(ctx.platform, options.signal).sniEndpoint.delete(appIdentity, sniEndpoint.id)
}

export type ResolveAndUpdateOptions = ResolveSniEndpointOptions & {
  /**
   * Runs once the endpoint is resolved, before it's updated. Callers can confirm here;
   * a throw (or abort) prevents the update.
   */
  beforeUpdate?: (preview: {sniEndpoint: SniEndpoint}) => Promise<void> | void
}

/**
 * Resolve an SNI endpoint (see `resolveSniEndpoint`) and replace its certificate.
 * @returns the updated endpoint.
 */
// eslint-disable-next-line max-params
export async function resolveAndUpdate(
  ctx: Pick<ResourceCtx, 'platform'>,
  appIdentity: string,
  selector: SniEndpointSelector,
  certificate: SniCertificate,
  options: ResolveAndUpdateOptions = {},
): Promise<SniEndpoint> {
  const sniEndpoint = await resolveSniEndpoint(ctx, appIdentity, selector, options)
  await options.beforeUpdate?.({sniEndpoint})
  options.signal?.throwIfAborted()
  return withSignal(ctx.platform, options.signal).sniEndpoint.update(appIdentity, sniEndpoint.id, {
    // eslint-disable-next-line camelcase
    certificate_chain: certificate.certificateChain,
    // eslint-disable-next-line camelcase
    private_key: certificate.privateKey,
  })
}

/** Map a 404 for the endpoint or domain to `notFound()`. A 404 for the app itself passes through. */
async function rethrowNotFound<T>(request: Promise<T>, notFound: () => Error): Promise<T> {
  try {
    return await request
  } catch (error) {
    if (isNotFound(error) && (error as {resource?: unknown}).resource !== 'app') throw notFound()
    throw error
  }
}

function isNotFound(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'statusCode' in error
    && (error as {statusCode: unknown}).statusCode === 404
}
