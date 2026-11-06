import type {LinkInfoResult} from '@heroku/types/data'

import type {ResourceCtx} from '../../core/extend-resource.js'
import type {ResolvedAddOn} from '../platform/add-on/types.js'
import type {PostgresAddonLike} from './internal/postgres-utils.js'
import type {ResolvedPgDatabase} from './internal/resolve-pg-database.js'
import type {LegacyDatabase} from './postgres-database.js'

import {extendResource} from '../../core/extend-resource.js'
import {withSignal} from '../../core/with-signal.js'
import {EssentialDatabaseNotSupportedError, getPostgresServiceName, isEssentialTier} from './internal/postgres-utils.js'
import {resolveAddonScopedThenGlobal} from './internal/resolve-addon-scoped.js'
import {resolvePgDatabase} from './internal/resolve-pg-database.js'
import {listLegacyByApp} from './postgres-database.js'

/** A Data Link between a local Postgres database and a remote Postgres database. */
// `@heroku/types` shares one shape across link list/info/create/delete results.
export type PgLink = LinkInfoResult

export type LinkedDatabase = {
  addon: LegacyDatabase
  links: PgLink[]
}

export type ListLinksByAppOptions = {
  signal?: AbortSignal
}

export type CreateLinkBody = {
  /** Name to register the link under. The API generates one when omitted. */
  as?: string
}

export type CreateLinkOptions = {
  /**
   * Runs once both sides are resolved and validated, before the link is
   * created. A throw (or abort) here prevents the create.
   */
  beforeCreate?: (preview: {addon: ResolvedPgDatabase; target: ResolvedAddOn}) => Promise<void> | void
  signal?: AbortSignal
}

export type CreateLinkResult = {
  addon: ResolvedPgDatabase
  link: PgLink
  target: ResolvedAddOn
}

export type DeleteLinkOptions = {
  /**
   * Runs once the database is resolved and validated, before the link is
   * deleted. Callers can confirm here; a throw (or abort) prevents the delete.
   */
  beforeDelete?: (preview: {addon: ResolvedPgDatabase; link: string}) => Promise<void> | void
  signal?: AbortSignal
}

export type DeleteLinkResult = {
  addon: ResolvedPgDatabase
  link: PgLink
}

/** Thrown when a link's remote isn't a Heroku Postgres add-on. Data Links only connect Postgres to Postgres. */
export class InvalidLinkRemoteError extends Error {
  public readonly id = 'invalid_link_remote'

  constructor(public readonly addon: ResolvedAddOn) {
    super(`${addon.name} isn't a Heroku Postgres add-on, so it can't be linked. Data Links only connect Heroku Postgres databases.`)
    this.name = 'InvalidLinkRemoteError'
  }

  public get body() {
    return {id: this.id, message: this.message}
  }
}

function assertLinksSupported(addon: PostgresAddonLike & {name: string}) {
  if (isEssentialTier(addon)) {
    throw new EssentialDatabaseNotSupportedError(addon, `Links aren't supported on Essential-tier databases. ${addon.name} is an Essential-tier database.`)
  }
}

function assertLinkableRemote(remote: ResolvedAddOn) {
  const service = remote.plan?.name?.split(':', 2)[0]
  if (service !== getPostgresServiceName()) {
    throw new InvalidLinkRemoteError(remote)
  }
}

/**
 * Lists the links on an app's Postgres databases.
 *
 * With `databaseIdentity`, resolves that one database (an attachment name,
 * config var, `app::attachment`, or add-on name) and returns its links. Without
 * it, returns the links on every legacy Postgres database attached to the app,
 * in attachment order. Each `addon` carries the `attachmentNames` it's known
 * by on the app (just the resolved attachment when `databaseIdentity` is given).
 *
 * Returns an empty array when the app has no databases. Links are fetched in
 * parallel, one request per database; the first failure rejects the call.
 */
export async function listByApp(
  ctx: Pick<ResourceCtx, 'data' | 'platform'>,
  appIdentity: string,
  databaseIdentity?: string,
  options: ListLinksByAppOptions = {},
): Promise<LinkedDatabase[]> {
  const {signal} = options
  signal?.throwIfAborted()

  const data = withSignal(ctx.data, signal)

  let databases: LegacyDatabase[]
  if (databaseIdentity) {
    const {addon, attachment} = await resolvePgDatabase(ctx, appIdentity, {includeAttachment: true, input: databaseIdentity, signal})
    databases = [{...addon, attachmentNames: [attachment.name]}]
  } else {
    databases = await listLegacyByApp(ctx, appIdentity, {signal})
  }

  return Promise.all(databases.map(async addon => {
    // `@heroku/types` declares the list response as `Record<string, unknown>`; the API returns an array of links.
    const links = await data.link.list(addon.id) as unknown as PgLink[]
    return {addon, links}
  }))
}

/**
 * Resolves a local and a remote Postgres database, then links the remote
 * into the local one.
 *
 * `databaseIdentity` resolves through the app's attachments (`''` means
 * `DATABASE_URL`). `remoteIdentity` resolves as an add-on, scoped to the app
 * first and then globally. Both resolve in parallel, so when both are invalid,
 * either error may surface.
 *
 * Throws `InvalidLinkRemoteError` when the remote isn't Heroku Postgres, and `EssentialDatabaseNotSupportedError` when either side is
 * Essential-tier.
 */
export async function createForDatabase(
  ctx: Pick<ResourceCtx, 'data' | 'platform'>,
  appIdentity: string,
  databaseIdentity: string,
  remoteIdentity: string,
  body: CreateLinkBody = {},
  options: CreateLinkOptions = {},
): Promise<CreateLinkResult> {
  const {beforeCreate, signal} = options
  signal?.throwIfAborted()

  const platform = withSignal(ctx.platform, signal)
  const data = withSignal(ctx.data, signal)

  const [addon, target] = await Promise.all([
    resolvePgDatabase(ctx, appIdentity, {input: databaseIdentity, signal}),
    resolveAddonScopedThenGlobal(platform, remoteIdentity, {appIdentity}).then(remote => {
      assertLinkableRemote(remote)
      return remote
    }),
  ])

  assertLinksSupported(addon)
  assertLinksSupported(target)

  await beforeCreate?.({addon, target})
  signal?.throwIfAborted()

  const link = await data.link.create(addon.id, {as: body.as, target: target.name})
  return {addon, link, target}
}

/**
 * Resolves a Postgres database and deletes one of its links.
 *
 * `databaseIdentity` resolves through the app's attachments (`''` means
 * `DATABASE_URL`). Throws `EssentialDatabaseNotSupportedError` when the
 * database is Essential-tier. If provided, `beforeDelete` runs before the
 * delete request; a throw there prevents it.
 */
export async function deleteFromDatabase(
  ctx: Pick<ResourceCtx, 'data' | 'platform'>,
  appIdentity: string,
  databaseIdentity: string,
  linkName: string,
  options: DeleteLinkOptions = {},
): Promise<DeleteLinkResult> {
  const {beforeDelete, signal} = options
  signal?.throwIfAborted()

  const data = withSignal(ctx.data, signal)

  const addon = await resolvePgDatabase(ctx, appIdentity, {input: databaseIdentity, signal})
  assertLinksSupported(addon)

  await beforeDelete?.({addon, link: linkName})
  signal?.throwIfAborted()

  const link = await data.link.delete(addon.id, linkName)
  return {addon, link}
}

export const linkExtensions = extendResource('data', 'link', ctx => ({
  createForDatabase: (
    appIdentity: string,
    databaseIdentity: string,
    remoteIdentity: string,
    body?: CreateLinkBody,
    options?: CreateLinkOptions,
  ) => createForDatabase(ctx, appIdentity, databaseIdentity, remoteIdentity, body, options),
  deleteFromDatabase: (
    appIdentity: string,
    databaseIdentity: string,
    linkName: string,
    options?: DeleteLinkOptions,
  ) => deleteFromDatabase(ctx, appIdentity, databaseIdentity, linkName, options),
  listByApp: (
    appIdentity: string,
    databaseIdentity?: string,
    options?: ListLinksByAppOptions,
  ) => listByApp(ctx, appIdentity, databaseIdentity, options),
}))
