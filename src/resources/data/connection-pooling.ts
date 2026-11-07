import type {ConnectionPoolingCreateOpts, ConnectionPoolingCreateResult} from '@heroku/types/data'

import type {ResourceCtx} from '../../core/extend-resource.js'
import type {ResolvedPgDatabase} from './internal/resolve-pg-database.js'

import {extendResource} from '../../core/extend-resource.js'
import {withSignal} from '../../core/with-signal.js'
import {EssentialDatabaseNotSupportedError, isEssentialTier} from './internal/postgres-utils.js'
import {resolvePgDatabase} from './internal/resolve-pg-database.js'

export type ConnectionPoolingAttachment = ConnectionPoolingCreateResult

/** `name` and `credential` as the API takes them; `credential` defaults to `default`. */
export type AttachConnectionPoolingBody = Omit<ConnectionPoolingCreateOpts, 'app'>

export type AttachConnectionPoolingOptions = {
  /**
   * Runs once the pool is attached, before the release version fetch. The
   * attachment already exists at this point, so a throw here doesn't undo it.
   */
  onAttached?: (attachment: ConnectionPoolingAttachment) => Promise<void> | void
  /**
   * Runs once the database is resolved and validated, before the attachment
   * is created. A throw (or abort) here prevents the create.
   */
  onResolved?: (addon: ResolvedPgDatabase) => Promise<void> | void
  signal?: AbortSignal
}

export type AttachConnectionPoolingResult = {
  addon: ResolvedPgDatabase
  attachment: ConnectionPoolingAttachment
  releaseVersion?: number
}

/**
 * Resolves a Postgres database, attaches a connection pooler for it to the
 * app, and fetches the latest release version.
 *
 * `databaseIdentity` resolves through the app's attachments (defaulting to
 * `DATABASE_URL` when empty). Throws `EssentialDatabaseNotSupportedError` when
 * the database is Essential-tier.
 *
 * The release lookup is best-effort: the pool is already attached by then, so
 * a failed lookup reports `releaseVersion: undefined` rather than rejecting
 * (an abort still rejects).
 *
 * A rejection doesn't always mean nothing changed: once `onAttached` runs, the
 * attachment exists, so a throw from `onAttached` or an abort after it still
 * leaves the pool attached. Don't blindly retry after a rejection — check the
 * app's attachments first, or retrying may create a second pool attachment.
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

  await onResolved?.(addon)
  signal?.throwIfAborted()

  const attachment = await data.connectionPooling.create(addon.name, {
    ...body,
    app: appIdentity,
    credential: body.credential ?? 'default',
  })

  await onAttached?.(attachment)
  signal?.throwIfAborted()

  let releaseVersion: number | undefined
  try {
    // A caller-supplied Range header disables auto-pagination, so this returns only the newest release.
    const releases = await platform
      .withHeaders({Range: 'version ..; max=1, order=desc'})
      .release.list(appIdentity)
    releaseVersion = releases[0]?.version
  } catch (error) {
    if (signal?.aborted) throw error
  }

  return {addon, attachment, releaseVersion}
}

export const connectionPoolingExtensions = extendResource('data', 'connectionPooling', ctx => ({
  attach: (
    appIdentity: string,
    databaseIdentity?: string,
    body?: AttachConnectionPoolingBody,
    options?: AttachConnectionPoolingOptions,
  ) => attach(ctx, appIdentity, databaseIdentity, body, options),
}))
