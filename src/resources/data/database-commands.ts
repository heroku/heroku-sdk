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
import {combineSignals, withSignal} from '../../core/with-signal.js'
import {requestWithTimeout, waitForDuration} from '../../utils/request-with-timeout.js'
import {resolvePgDatabase} from './internal/resolve-pg-database.js'

const DEFAULT_PROMOTION_NAME = 'DATABASE'
const POOLER_NAMESPACE = 'connection-pooling:default'
const POOLER_ATTACHMENT_NAME = 'DATABASE_CONNECTION_POOL'
const RELEASE_LIST_RANGE = 'version ..; max=5, order=desc'
const RELEASE_PHASE_TIMEOUT_MS = 900_000
const RELEASE_PHASE_POLL_INTERVAL_MS = 5000
const RELEASE_PHASE_TIMED_OUT = Symbol('release_phase_timed_out')

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

export class DatabasePromotionError extends Error {
  constructor(
    public readonly result: PromoteDatabasePartialResult,
    cause: unknown,
  ) {
    super('Database promotion encountered an error after attachment mutation began.', {cause})
    this.name = 'DatabasePromotionError'
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
  /** Runs after resolution, alias inspection, and readiness checks, before mutation. */
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

export type PromoteDatabasePartialResult = {
  addon: ResolvedPgDatabase
  attachment?: AddOnAttachment
  backupAttachment?: AddOnAttachment
  database?: DatabaseCommandInfo
  mutationStatus: {
    attachment: PromotionMutationStatus
    backupAttachment: PromotionMutationStatus
    poolerAttachment: PromotionMutationStatus
  }
  poolerAttachment?: AddOnAttachment
  releasePhase?: {
    attach?: Release
    detach?: Release
    status: 'failed' | 'succeeded' | 'timed_out' | 'unknown'
  }
}

export type PromoteDatabaseResult = PromoteDatabasePartialResult & {
  attachment: AddOnAttachment
}

export type PromotionMutationStatus = {
  attempted: boolean
  status: 'created' | 'not_attempted' | 'unknown'
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
  ctx: Pick<ResourceCtx, 'data' | 'operationSignal' | 'platform'>,
  appIdentity: string,
  databaseIdentity?: string,
  options: PromoteDatabaseOptions = {},
): Promise<PromoteDatabaseResult> {
  const {
    as, beforePromote, force, onBackupAttachment, releasePhasePollIntervalMs = RELEASE_PHASE_POLL_INTERVAL_MS,
    releasePhaseTimeoutMs = RELEASE_PHASE_TIMEOUT_MS, signal: callerSignal,
  } = options
  validateReleasePhaseTimeouts(releasePhaseTimeoutMs, releasePhasePollIntervalMs)
  const signal = combineSignals(ctx.operationSignal, callerSignal)
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

  if (!force) {
    const status = await data.database.waitStatus(addon.id)
    if (status['waiting?']) throw new DatabaseNotReadyError(status)
  }

  signal?.throwIfAborted()
  await beforePromote?.({
    addon, appIdentity, attachment, currentAttachment: current, existingAlias,
  })
  signal?.throwIfAborted()

  const promotionBody: AddOnAttachmentCreateOpts = {
    addon: addon.name,
    app: appIdentity,
    confirm: appIdentity,
    name: as || DEFAULT_PROMOTION_NAME,
    namespace: attachment.namespace || null,
  }
  const result: PromoteDatabasePartialResult = {
    addon,
    mutationStatus: {
      attachment: {attempted: false, status: 'not_attempted'},
      backupAttachment: {attempted: false, status: 'not_attempted'},
      poolerAttachment: {attempted: false, status: 'not_attempted'},
    },
  }
  const currentPooler = current && attachments.find(item => (
    item.namespace === POOLER_NAMESPACE
    && item.addon.id === current.addon.id
    && item.name === POOLER_ATTACHMENT_NAME
  ))
  let checkingReleasePhase = false
  try {
    if (current && !existingAlias) {
      result.mutationStatus.backupAttachment = {attempted: true, status: 'unknown'}
      result.backupAttachment = await platform.addOnAttachment.create({
        addon: current.addon.name,
        app: appIdentity,
        confirm: appIdentity,
        namespace: current.namespace,
      })
      result.mutationStatus.backupAttachment = {attempted: true, status: 'created'}
      await onBackupAttachment?.(result.backupAttachment)
    }

    result.mutationStatus.attachment = {attempted: true, status: 'unknown'}
    result.attachment = await platform.addOnAttachment.create(promotionBody)
    result.mutationStatus.attachment = {attempted: true, status: 'created'}

    if (currentPooler) {
      result.mutationStatus.poolerAttachment = {attempted: true, status: 'unknown'}
      result.poolerAttachment = await platform.addOnAttachment.create({
        addon: addon.name,
        app: appIdentity,
        confirm: appIdentity,
        name: currentPooler.name,
        namespace: POOLER_NAMESPACE,
      })
      result.mutationStatus.poolerAttachment = {attempted: true, status: 'created'}
    }

    result.database = await data.database.info(addon.id) as DatabaseCommandInfo
    checkingReleasePhase = true
    result.releasePhase = await waitForDatabasePromotionRelease(appIdentity, platform, {
      onProgress(releasePhase) {
        result.releasePhase = releasePhase
      },
      pollIntervalMs: releasePhasePollIntervalMs,
      signal,
      timeoutMs: releasePhaseTimeoutMs,
    })

    return result as PromoteDatabaseResult
  } catch (error) {
    if (checkingReleasePhase) result.releasePhase = {...result.releasePhase, status: 'unknown'}
    throwPostPromotionError(result, error, signal)
  }
}

/** Resolve a follower and its displayed origin, then stop replication. */
export async function unfollowDatabase(
  ctx: Pick<ResourceCtx, 'data' | 'operationSignal' | 'platform'>,
  appIdentity: string,
  databaseIdentity?: string,
  options: UnfollowDatabaseOptions = {},
): Promise<UnfollowDatabaseResult> {
  const {beforeUnfollow, signal: callerSignal} = options
  const signal = combineSignals(ctx.operationSignal, callerSignal)
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
  ctx: Pick<ResourceCtx, 'data' | 'operationSignal' | 'platform'>,
  appIdentity: string,
  databaseIdentity?: string,
  options: ResetDatabaseOptions = {},
): Promise<ResetDatabaseResult> {
  const {beforeReset, extensions, signal: callerSignal} = options
  const signal = combineSignals(ctx.operationSignal, callerSignal)
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

/* eslint-disable no-await-in-loop, complexity -- release status polling is sequential and preserves legacy guards */
async function waitForDatabasePromotionRelease(
  appIdentity: string,
  platform: ResourceCtx['platform'],
  options: {
    onProgress: (releasePhase: NonNullable<PromoteDatabaseResult['releasePhase']>) => void
    pollIntervalMs: number
    signal?: AbortSignal
    timeoutMs: number
  },
): Promise<PromoteDatabaseResult['releasePhase']> {
  const formation = await platform.formation.list(appIdentity) as Formation[]
  if (!formation.some(process => process.type === 'release')) return undefined

  const releases = await platform.withHeaders({Range: RELEASE_LIST_RANGE}).release.list(appIdentity) as Release[]
  const attachRelease = releases.find(release => release.description?.includes('Attach DATABASE'))
  const detachRelease = releases.find(release => release.description?.includes('Detach DATABASE'))
  const attachId = attachRelease?.id
  const detachId = detachRelease?.id

  if (attachRelease || detachRelease) {
    options.onProgress({attach: attachRelease, detach: detachRelease, status: 'unknown'})
  }

  if (!attachId || !detachId) throw new DatabaseReleasePhaseError(appIdentity)

  const deadline = Date.now() + options.timeoutMs
  const pendingAttach = {...attachRelease!, status: 'pending'} as Release
  let lastAttach = pendingAttach
  options.onProgress({attach: lastAttach, status: 'unknown'})
  while (true) {
    options.signal?.throwIfAborted()
    const remainingMs = deadline - Date.now()
    if (remainingMs <= 0) return {attach: lastAttach, status: 'timed_out'}

    const attach = await waitForReleaseInfo(
      requestSignal => withSignal(platform, requestSignal).release.info(appIdentity, attachId),
      remainingMs,
      options.signal,
    )
    if (attach === RELEASE_PHASE_TIMED_OUT || Date.now() >= deadline) {
      return {attach: lastAttach, status: 'timed_out'}
    }

    lastAttach = attach
    options.onProgress({
      attach: lastAttach,
      status: attach.status === 'succeeded' || attach.status === 'failed' ? attach.status : 'unknown',
    })
    if (attach.status === 'succeeded') {
      const detach = await waitForReleaseInfo(
        requestSignal => withSignal(platform, requestSignal).release.info(appIdentity, detachId),
        deadline - Date.now(),
        options.signal,
      )
      if (detach === RELEASE_PHASE_TIMED_OUT || Date.now() >= deadline) return {attach, status: 'succeeded'}
      return {attach, detach, status: 'succeeded'}
    }

    if (attach.status === 'failed') {
      const detach = await waitForReleaseInfo(
        requestSignal => withSignal(platform, requestSignal).release.info(appIdentity, detachId),
        deadline - Date.now(),
        options.signal,
      )
      if (detach === RELEASE_PHASE_TIMED_OUT || Date.now() >= deadline) return {attach, status: 'failed'}
      return {attach, detach, status: 'failed'}
    }

    const pollDelayMs = Math.min(options.pollIntervalMs, deadline - Date.now())
    await waitForDuration(pollDelayMs, options.signal)
  }
}
/* eslint-enable no-await-in-loop */

async function waitForReleaseInfo<T>(
  request: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<T | typeof RELEASE_PHASE_TIMED_OUT> {
  return requestWithTimeout(request, {signal, timeoutMs, timeoutValue: RELEASE_PHASE_TIMED_OUT})
}

function validateReleasePhaseTimeouts(timeoutMs: number, pollIntervalMs: number): void {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new RangeError('releasePhaseTimeoutMs must be a finite positive number')
  }

  if (!Number.isFinite(pollIntervalMs) || pollIntervalMs <= 0) {
    throw new RangeError('releasePhasePollIntervalMs must be a finite positive number')
  }
}

function throwPostPromotionError(
  result: PromoteDatabasePartialResult,
  cause: unknown,
  signal?: AbortSignal,
): never {
  if (signal?.aborted && cause === (signal.reason ?? cause)
    && cause && typeof cause === 'object' && Object.isExtensible(cause)) {
    try {
      Object.defineProperty(cause, 'promotionResult', {configurable: true, value: result})
    } catch {
      // The typed error below still carries partial state when the cause cannot be extended.
    }
  }

  throw new DatabasePromotionError(result, cause)
}

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
