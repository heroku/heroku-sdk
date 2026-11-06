import type {ConnectionPoolingCreateResult} from '@heroku/types/data'

import type {ResourceCtx} from '../../core/extend-resource.js'
import type {ResolvedPgDatabase} from './internal/resolve-pg-database.js'

import {extendResource} from '../../core/extend-resource.js'
import {withSignal} from '../../core/with-signal.js'
import {EssentialDatabaseNotSupportedError, isEssentialTier} from './internal/postgres-utils.js'
import {resolvePgDatabase} from './internal/resolve-pg-database.js'

export type ConnectionPoolingAttachment = ConnectionPoolingCreateResult

export type AttachConnectionPoolingBody = {
  /** Name for the connection pooling attachment. The API generates one when omitted. */
  as?: string
}

export type AttachConnectionPoolingOptions = {
  /** Fires once the attachment is created, before the release version fetch. */
  onAttached?: (attachment: ConnectionPoolingAttachment) => Promise<void> | void
  /**
   * Fires once the database is resolved and validated, before the attachment
   * is created. A throw (or abort) here prevents the create.
   */
  onResolved?: (resolved: {addon: ResolvedPgDatabase}) => Promise<void> | void
  signal?: AbortSignal
}

export type AttachConnectionPoolingResult = {
  addon: ResolvedPgDatabase
  attachment: ConnectionPoolingAttachment
  releaseVersion?: number
}

/**
 * Resolves a Postgres database, attaches a connection pooler for it to the
 * app using the default credential, and fetches the latest release version.
 *
 * `databaseIdentity` resolves through the app's attachments (defaulting to
 * `DATABASE_URL` when empty). Throws `EssentialDatabaseNotSupportedError` when
 * the database is Essential-tier.
 */
export async function attach(
  ctx: Pick<ResourceCtx, 'data' | 'platform'>,
  appIdentity: string,
  databaseIdentity?: string,
  body: AttachConnectionPoolingBody = {},
  options: AttachConnectionPoolingOptions = {},
): Promise<AttachConnectionPoolingResult> {
  const {onAttached, onResolved, signal} = options
  signal?.throwIfAborted()

  const platform = withSignal(ctx.platform, signal)
  const data = withSignal(ctx.data, signal)

  const addon = await resolvePgDatabase(ctx, appIdentity, {input: databaseIdentity, signal})
  if (isEssentialTier(addon)) {
    throw new EssentialDatabaseNotSupportedError(addon, `Connection pooling isn't supported on Essential-tier databases. ${addon.name} is an Essential-tier database.`)
  }

  await onResolved?.({addon})
  signal?.throwIfAborted()

  const attachment = await data.connectionPooling.create(addon.name, {
    app: appIdentity,
    credential: 'default',
    name: body.as,
  })

  await onAttached?.(attachment)
  signal?.throwIfAborted()

  // A caller-supplied Range header disables auto-pagination, so this returns only the newest release.
  const releases = await platform
    .withHeaders({Range: 'version ..; max=1, order=desc'})
    .release.list(appIdentity)

  return {addon, attachment, releaseVersion: releases[0]?.version}
}

export const connectionPoolingExtensions = extendResource('data', 'connectionPooling', ctx => ({
  attach: (
    appIdentity: string,
    databaseIdentity?: string,
    body?: AttachConnectionPoolingBody,
    options?: AttachConnectionPoolingOptions,
  ) => attach(ctx, appIdentity, databaseIdentity, body, options),
}))

export {EssentialDatabaseNotSupportedError} from './internal/postgres-utils.js'
