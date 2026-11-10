import type {
  AddOnAttachment,
  AddOnAttachmentCreateOpts,
  ConfigVar,
  Formation,
  Release,
} from '@heroku/types/3.sdk'
import type {
  DatabaseInfoResult,
  DatabaseResetOpts,
  DatabaseResetResult as DatabaseResetResponse,
  DatabaseUnfollowResult as DatabaseUnfollowResponse,
  DatabaseWaitStatusResult,
} from '@heroku/types/data'

import type {ResourceCtx} from '../../core/extend-resource.js'
import type {ResolvedPgDatabase} from './internal/resolve-pg-database.js'

import {extendResource} from '../../core/extend-resource.js'
import {withSignal} from '../../core/with-signal.js'
import {wait} from '../../utils/wait.js'
import {resolvePgDatabase} from './internal/resolve-pg-database.js'

const DEFAULT_PROMOTION_NAME = 'DATABASE'
const POOLER_NAMESPACE = 'connection-pooling:default'
const POOLER_ATTACHMENT_NAME = 'DATABASE_CONNECTION_POOL'
const RELEASE_LIST_RANGE = 'version ..; max=5, order=desc'
const RELEASE_PHASE_TIMEOUT_MS = 900_000
const RELEASE_PHASE_POLL_INTERVAL_MS = 5000

export type DatabaseCommandInfo = Omit<DatabaseInfoResult, 'leader'> & {
  following?: null | string
  leader?: unknown
}

export class DatabaseNotReadyError extends Error {
  constructor(public readonly status: DatabaseWaitStatusResult) {
    super(`Database cannot be promoted while in state: ${status.message}`)
    this.name = 'DatabaseNotReadyError'
  }
}

export class DatabaseAlreadyPromotedError extends Error {
  constructor(
    public readonly appIdentity: string,
    public readonly addon: ResolvedPgDatabase,
    public readonly attachment: AddOnAttachment,
  ) {
    super(`${attachment.name} is already promoted on ${appIdentity}`)
    this.name = 'DatabaseAlreadyPromotedError'
  }
}

export class DatabaseReleasePhaseError extends Error {
  constructor(public readonly appIdentity: string) {
    super(`Unable to check release phase for ${appIdentity}. Check your Attach DATABASE release for failures.`)
    this.name = 'DatabaseReleasePhaseError'
  }
}

export class DatabaseNotFollowerError extends Error {
  constructor(public readonly addon: ResolvedPgDatabase) {
    super(`${addon.name} is not a follower`)
    this.name = 'DatabaseNotFollowerError'
  }
}

export type PromoteDatabasePreview = {
  addon: ResolvedPgDatabase
  appIdentity: string
  attachment: AddOnAttachment
  currentAttachment?: AddOnAttachment
  existingAlias?: AddOnAttachment
}

export type PromoteDatabaseOptions = {
  /** Attachment name to create for the promoted database; defaults to DATABASE. */
  as?: string
  /** Runs after resolution and alias inspection, before the first attachment mutation. */
  beforePromote?: (preview: PromoteDatabasePreview) => Promise<void> | void
  /** Skip the legacy database readiness check. */
  force?: boolean
  /** Runs after the current DATABASE backup alias is created, if needed. */
  onBackupAttachment?: (attachment: AddOnAttachment) => Promise<void> | void
  /** Delay between release-phase status polls. Defaults to 5 seconds. */
  releasePhasePollIntervalMs?: number
  /** Maximum time to wait for release-phase completion. Defaults to 15 minutes. */
  releasePhaseTimeoutMs?: number
  signal?: AbortSignal
}

export type PromoteDatabaseResult = {
  addon: ResolvedPgDatabase
  attachment: AddOnAttachment
  backupAttachment?: AddOnAttachment
  database: DatabaseCommandInfo
  poolerAttachment?: AddOnAttachment
  releasePhase?: {
    attach: Release
    detach?: Release
    status: 'failed' | 'succeeded' | 'timed_out'
  }
}

export type UnfollowDatabasePreview = {
  addon: ResolvedPgDatabase
  appIdentity: string
  attachment: AddOnAttachment
  database: DatabaseCommandInfo
  following: string
  origin: string
}

export type UnfollowDatabaseOptions = {
  /** Runs after resolving follower/origin details and before the unfollow request. */
  beforeUnfollow?: (preview: UnfollowDatabasePreview) => Promise<void> | void
  signal?: AbortSignal
}

export type UnfollowDatabaseResult = {
  addon: ResolvedPgDatabase
  database: DatabaseCommandInfo
  following: string
  origin: string
  result: DatabaseUnfollowResponse
}

export type ResetDatabaseOptions = {
  /**
   * Runs after the database is resolved and before the reset request. A throw
   * (or abort) from the callback prevents the destructive request.
   */
  beforeReset?: (preview: {addon: ResolvedPgDatabase; appIdentity: string}) => Promise<void> | void
  /** Comma-separated extension names, or an already split list. */
  extensions?: string | string[]
  signal?: AbortSignal
}

export type ResetDatabaseResult = {
  addon: ResolvedPgDatabase
  result: DatabaseResetResponse
}

/** Resolve a database, protect the existing alias, and promote it to DATABASE. */
// eslint-disable-next-line complexity -- preserve the legacy promotion sequence and its guards
export async function promoteDatabase(
  ctx: Pick<ResourceCtx, 'data' | 'platform'>,
  appIdentity: string,
  databaseIdentity?: string,
  options: PromoteDatabaseOptions = {},
): Promise<PromoteDatabaseResult> {
  const {
    as, beforePromote, force, onBackupAttachment, releasePhasePollIntervalMs = RELEASE_PHASE_POLL_INTERVAL_MS,
    releasePhaseTimeoutMs = RELEASE_PHASE_TIMEOUT_MS, signal,
  } = options
  signal?.throwIfAborted()

  const resolved = await resolvePgDatabase(ctx, appIdentity, {
    includeAttachment: true,
    input: databaseIdentity,
    signal,
  })
  const {addon, attachment} = resolved
  const platform = withSignal(ctx.platform, signal)
  const data = withSignal(ctx.data, signal)
  const attachments = await platform.addOnAttachment.listByApp(appIdentity)

  const current = attachments.find(item => item.name === DEFAULT_PROMOTION_NAME)
  if (current && current.addon.name === addon.name && (current.namespace ?? null) === (attachment.namespace ?? null)) {
    throw new DatabaseAlreadyPromotedError(appIdentity, addon, attachment)
  }

  const existingAlias = current && attachments.find(item => (
    item.addon.id === current.addon.id
    && item.namespace === current.namespace
    && item.name !== DEFAULT_PROMOTION_NAME
  ))

  await beforePromote?.({
    addon, appIdentity, attachment, currentAttachment: current, existingAlias,
  })
  signal?.throwIfAborted()

  let backupAttachment: AddOnAttachment | undefined
  if (current && !existingAlias) {
    backupAttachment = await platform.addOnAttachment.create({
      addon: current.addon.name,
      app: appIdentity,
      confirm: appIdentity,
      namespace: current.namespace,
    })
    await onBackupAttachment?.(backupAttachment)
  }

  if (!force) {
    const status = await data.database.waitStatus(addon.id)
    if (status['waiting?']) throw new DatabaseNotReadyError(status)
  }

  const promotionBody: AddOnAttachmentCreateOpts = {
    addon: addon.name,
    app: appIdentity,
    confirm: appIdentity,
    name: as || DEFAULT_PROMOTION_NAME,
    namespace: attachment.namespace || null,
  }
  const promotedAttachment = await platform.addOnAttachment.create(promotionBody)

  const currentPooler = current && attachments.find(item => (
    item.namespace === POOLER_NAMESPACE
    && item.addon.id === current.addon.id
    && item.name === POOLER_ATTACHMENT_NAME
  ))
  let poolerAttachment: AddOnAttachment | undefined
  if (currentPooler) {
    poolerAttachment = await platform.addOnAttachment.create({
      addon: addon.name,
      app: appIdentity,
      confirm: appIdentity,
      name: currentPooler.name,
      namespace: POOLER_NAMESPACE,
    })
  }

  const database = await data.database.info(addon.id) as DatabaseCommandInfo
  const releasePhase = await waitForDatabasePromotionRelease(appIdentity, platform, {
    pollIntervalMs: releasePhasePollIntervalMs,
    signal,
    timeoutMs: releasePhaseTimeoutMs,
  })

  return {
    addon,
    attachment: promotedAttachment,
    backupAttachment,
    database,
    poolerAttachment,
    releasePhase,
  }
}

/** Resolve a follower and its displayed origin, then stop replication. */
export async function unfollowDatabase(
  ctx: Pick<ResourceCtx, 'data' | 'platform'>,
  appIdentity: string,
  databaseIdentity?: string,
  options: UnfollowDatabaseOptions = {},
): Promise<UnfollowDatabaseResult> {
  const {beforeUnfollow, signal} = options
  signal?.throwIfAborted()

  const resolved = await resolvePgDatabase(ctx, appIdentity, {
    includeAttachment: true,
    input: databaseIdentity,
    signal,
  })
  const {addon, attachment} = resolved
  const data = withSignal(ctx.data, signal)
  const platform = withSignal(ctx.platform, signal)
  const database = await data.database.info(addon.id) as DatabaseCommandInfo

  if (!database.following) throw new DatabaseNotFollowerError(addon)

  const configVars = await platform.configVar.infoForApp(appIdentity) as ConfigVar
  const origin = databaseNameFromUrl(database.following, configVars)
  const preview = {
    addon,
    appIdentity,
    attachment,
    database,
    following: database.following,
    origin,
  }

  await beforeUnfollow?.(preview)
  signal?.throwIfAborted()

  const result = await data.database.unfollow(addon.id)
  return {...preview, result}
}

/** Resolve a database and reset it with the requested public-schema extensions. */
export async function resetDatabase(
  ctx: Pick<ResourceCtx, 'data' | 'platform'>,
  appIdentity: string,
  databaseIdentity?: string,
  options: ResetDatabaseOptions = {},
): Promise<ResetDatabaseResult> {
  const {beforeReset, extensions, signal} = options
  signal?.throwIfAborted()

  const addon = await resolvePgDatabase(ctx, appIdentity, {input: databaseIdentity, signal})

  await beforeReset?.({addon, appIdentity})
  signal?.throwIfAborted()

  const body: DatabaseResetOpts = {}
  const normalizedExtensions = normalizeExtensions(extensions)
  if (normalizedExtensions !== undefined) body.extensions = normalizedExtensions

  const data = withSignal(ctx.data, signal)
  const result = await data.database.reset(addon.id, body)

  return {addon, result}
}

/* eslint-disable no-await-in-loop -- release status polling is sequential */
async function waitForDatabasePromotionRelease(
  appIdentity: string,
  platform: ResourceCtx['platform'],
  options: {pollIntervalMs: number; signal?: AbortSignal; timeoutMs: number},
): Promise<PromoteDatabaseResult['releasePhase']> {
  const formation = await platform.formation.list(appIdentity) as Formation[]
  if (!formation.some(process => process.type === 'release')) return undefined

  const releases = await platform.withHeaders({Range: RELEASE_LIST_RANGE}).release.list(appIdentity) as Release[]
  const attachId = releases.find(release => release.description?.includes('Attach DATABASE'))?.id
  const detachId = releases.find(release => release.description?.includes('Detach DATABASE'))?.id
  if (!attachId || !detachId) throw new DatabaseReleasePhaseError(appIdentity)

  const deadline = Date.now() + options.timeoutMs
  while (true) {
    options.signal?.throwIfAborted()
    const attach = await platform.release.info(appIdentity, attachId)
    if (attach.status === 'succeeded') {
      const detach = await platform.release.info(appIdentity, detachId)
      return {attach, detach, status: 'succeeded'}
    }

    if (attach.status === 'failed') {
      const detach = await platform.release.info(appIdentity, detachId)
      return {attach, detach, status: 'failed'}
    }

    if (Date.now() > deadline) return {attach, status: 'timed_out'}

    await wait(options.pollIntervalMs, options.signal)
  }
}
/* eslint-enable no-await-in-loop */

function databaseNameFromUrl(uri: string, configVars: ConfigVar): string {
  const names = Object.keys(configVars).filter(name => urlsMatch(configVars[name], uri))
  names.sort((a, b) => Number(a === 'DATABASE_URL') - Number(b === 'DATABASE_URL'))

  let name = names.pop()
  while (names.length > 0 && name === 'DATABASE_URL') name = names.pop()
  if (name) return name.replace(/_URL$/, '')

  const connection = new URL(uri)
  return `${connection.hostname}:${connection.port || defaultPort(connection.protocol)}${connection.pathname}`
}

function urlsMatch(candidate: string, value: string): boolean {
  if (candidate === value) return true
  if (!candidate.startsWith('postgres://')) return false

  try {
    const candidateUrl = new URL(candidate)
    const valueUrl = new URL(value)
    return ['protocol', 'hostname', 'port', 'pathname'].every(component => (
      candidateUrl[component as keyof URL] === valueUrl[component as keyof URL]
    ))
  } catch {
    return false
  }
}

function defaultPort(protocol: string): string {
  return protocol === 'postgres:' || protocol === 'postgresql:' ? '5432' : ''
}

function normalizeExtensions(extensions?: string | string[]): string[] | undefined {
  if (extensions === undefined || extensions === '') return undefined

  return (Array.isArray(extensions) ? extensions : extensions.split(','))
    .map(extension => extension.trim().toLowerCase())
    .sort()
}

export const databaseCommandExtensions = extendResource('data', 'database', ctx => ({
  promote: (
    appIdentity: string,
    databaseIdentity?: string,
    options?: PromoteDatabaseOptions,
  ) => promoteDatabase(ctx, appIdentity, databaseIdentity, options),
  resetForApp: (
    appIdentity: string,
    databaseIdentity?: string,
    options?: ResetDatabaseOptions,
  ) => resetDatabase(ctx, appIdentity, databaseIdentity, options),
  unfollowForApp: (
    appIdentity: string,
    databaseIdentity?: string,
    options?: UnfollowDatabaseOptions,
  ) => unfollowDatabase(ctx, appIdentity, databaseIdentity, options),
}))
