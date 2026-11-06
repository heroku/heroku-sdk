import type {LinkInfoResult} from '@heroku/types/data'

import {NotFoundError} from '@heroku/heroku-fetch'

import type {ResourceCtx} from '../../core/extend-resource.js'
import type {ResolvedAddOn} from '../platform/add-on/types.js'
import type {PostgresAddonLike} from './internal/postgres-utils.js'
import type {ResolvedPgDatabase} from './internal/resolve-pg-database.js'
import type {LegacyDatabase} from './postgres-database.js'

import {extendResource} from '../../core/extend-resource.js'
import {withSignal} from '../../core/with-signal.js'
import {AddonNotFoundError} from '../platform/add-on/errors.js'
import {resolveAddonInternal} from '../platform/add-on/resolve.js'
import {EssentialDatabaseNotSupportedError, isEssentialTier} from './internal/postgres-utils.js'
import {resolvePgDatabase} from './internal/resolve-pg-database.js'
import {listLegacyByApp} from './postgres-database.js'

/** A dataset link between a Postgres database and a remote data store. */
export type PgLink = LinkInfoResult

export type LinkedDatabase = {
  addon: LegacyDatabase | ResolvedPgDatabase
  links: PgLink[]
}

export type ListByAppOptions = {
  signal?: AbortSignal
}

export type CreateForDatabaseBody = {
  /** Name to register the link under. The API generates one when omitted. */
  as?: string
}

export type CreateForDatabaseOptions = {
  /**
   * Fires once both sides are resolved and validated, before the link is
   * created. A throw (or abort) here prevents the create.
   */
  onResolved?: (resolved: {addon: ResolvedPgDatabase; target: ResolvedAddOn}) => Promise<void> | void
  signal?: AbortSignal
}

export type CreateForDatabaseResult = {
  addon: ResolvedPgDatabase
  link: PgLink
  target: ResolvedAddOn
}

export type DeleteFromDatabaseOptions = {
  /**
   * Fires once the database is resolved and validated, before the link is
   * deleted. Callers can confirm here; a throw (or abort) prevents the delete.
   */
  onResolved?: (resolved: {addon: ResolvedPgDatabase}) => Promise<void> | void
  signal?: AbortSignal
}

export type DeleteFromDatabaseResult = {
  addon: ResolvedPgDatabase
  link: PgLink
}

/** Thrown when a link's remote isn't a Heroku Postgres or Heroku Key-Value Store add-on. */
export class InvalidLinkRemoteError extends Error {
  public readonly id = 'invalid_link_remote'

  constructor(public readonly addon: ResolvedAddOn) {
    super(`${addon.name} isn't a Heroku Postgres or Heroku Key-Value Store add-on, so it can't be linked.`)
    this.name = 'InvalidLinkRemoteError'
  }

  public get body() {
    return {id: this.id, message: this.message}
  }
}

const REMOTE_PLAN = /^heroku-(redis|postgresql)/

function assertLinksSupported(addon: PostgresAddonLike & {name: string}) {
  if (isEssentialTier(addon)) {
    throw new EssentialDatabaseNotSupportedError(addon, `Links aren't supported on Essential-tier databases. ${addon.name} is an Essential-tier database.`)
  }
}

/**
 * Resolves the remote side of a link by add-on identity, scoped to the app
 * first and then globally, so a remote owned by a different app still
 * resolves by its globally-unique name.
 */
async function resolveRemote(
  platform: Pick<ResourceCtx, 'platform'>['platform'],
  appIdentity: string,
  remoteIdentity: string,
): Promise<ResolvedAddOn> {
  if (remoteIdentity.includes('::')) {
    return resolveAddonInternal(platform, remoteIdentity)
  }

  try {
    return await resolveAddonInternal(platform, remoteIdentity, {appIdentity})
  } catch (error) {
    if (!(error instanceof NotFoundError) && !(error instanceof AddonNotFoundError)) {
      throw error
    }

    return resolveAddonInternal(platform, remoteIdentity)
  }
}

/**
 * Lists the links on an app's Postgres databases.
 *
 * With `databaseIdentity`, resolves that one database (an attachment name,
 * config var, `app::attachment`, or add-on name) and returns its links. Without
 * it, returns the links on every legacy Postgres database attached to the app,
 * in attachment order. Returns an empty array when the app has no databases.
 */
export async function listByApp(
  ctx: Pick<ResourceCtx, 'data' | 'platform'>,
  appIdentity: string,
  databaseIdentity?: string,
  options: ListByAppOptions = {},
): Promise<LinkedDatabase[]> {
  const {signal} = options
  signal?.throwIfAborted()

  const data = withSignal(ctx.data, signal)
  const databases: Array<LegacyDatabase | ResolvedPgDatabase> = databaseIdentity
    ? [await resolvePgDatabase(ctx, appIdentity, {input: databaseIdentity, signal})]
    : await listLegacyByApp(ctx, appIdentity, {signal})

  return Promise.all(databases.map(async addon => {
    const links = await data.link.list(addon.id) as unknown as PgLink[]
    return {addon, links}
  }))
}

/**
 * Resolves a Postgres database and a remote data store, then links the
 * remote into the database.
 *
 * `databaseIdentity` resolves through the app's attachments (defaulting to
 * `DATABASE_URL` when empty). `remoteIdentity` resolves as an add-on, scoped to
 * the app first and then globally. Throws `InvalidLinkRemoteError` when the
 * remote isn't Postgres or Key-Value Store, and
 * `EssentialDatabaseNotSupportedError` when either side is Essential-tier.
 */
export async function createForDatabase(
  ctx: Pick<ResourceCtx, 'data' | 'platform'>,
  appIdentity: string,
  databaseIdentity: string | undefined,
  remoteIdentity: string,
  body: CreateForDatabaseBody = {},
  options: CreateForDatabaseOptions = {},
): Promise<CreateForDatabaseResult> {
  const {onResolved, signal} = options
  signal?.throwIfAborted()

  const platform = withSignal(ctx.platform, signal)
  const data = withSignal(ctx.data, signal)

  const [addon, target] = await Promise.all([
    resolvePgDatabase(ctx, appIdentity, {input: databaseIdentity, signal}),
    resolveRemote(platform, appIdentity, remoteIdentity).then(remote => {
      if (!REMOTE_PLAN.test(remote.plan?.name ?? '')) throw new InvalidLinkRemoteError(remote)
      return remote
    }),
  ])

  assertLinksSupported(addon)
  assertLinksSupported(target)

  await onResolved?.({addon, target})
  signal?.throwIfAborted()

  const link = await data.link.create(addon.id, {as: body.as, target: target.name})
  return {addon, link, target}
}

/**
 * Resolves a Postgres database and deletes one of its links.
 *
 * Throws `EssentialDatabaseNotSupportedError` when the database is
 * Essential-tier. If provided, `onResolved` runs before the delete request.
 */
export async function deleteFromDatabase(
  ctx: Pick<ResourceCtx, 'data' | 'platform'>,
  appIdentity: string,
  databaseIdentity: string | undefined,
  linkName: string,
  options: DeleteFromDatabaseOptions = {},
): Promise<DeleteFromDatabaseResult> {
  const {onResolved, signal} = options
  signal?.throwIfAborted()

  const data = withSignal(ctx.data, signal)

  const addon = await resolvePgDatabase(ctx, appIdentity, {input: databaseIdentity, signal})
  assertLinksSupported(addon)

  await onResolved?.({addon})
  signal?.throwIfAborted()

  const link = await data.link.delete(addon.id, linkName)
  return {addon, link}
}

export const linkExtensions = extendResource('data', 'link', ctx => ({
  createForDatabase: (
    appIdentity: string,
    databaseIdentity: string | undefined,
    remoteIdentity: string,
    body?: CreateForDatabaseBody,
    options?: CreateForDatabaseOptions,
  ) => createForDatabase(ctx, appIdentity, databaseIdentity, remoteIdentity, body, options),
  deleteFromDatabase: (
    appIdentity: string,
    databaseIdentity: string | undefined,
    linkName: string,
    options?: DeleteFromDatabaseOptions,
  ) => deleteFromDatabase(ctx, appIdentity, databaseIdentity, linkName, options),
  listByApp: (
    appIdentity: string,
    databaseIdentity?: string,
    options?: ListByAppOptions,
  ) => listByApp(ctx, appIdentity, databaseIdentity, options),
}))

export {EssentialDatabaseNotSupportedError} from './internal/postgres-utils.js'
