import type {TransferCreateOpts, TransferCreateResult, TransferInfoByAppResult} from '@heroku/types/data'

import type {ResourceCtx} from '../../core/extend-resource.js'
import type {Poller} from '../../utils/poller.js'
import type {ResolvedPgDatabaseWithAttachment} from './internal/resolve-pg-database.js'
import type {CredentialInfo} from './postgres-database/credentials.js'
import type {WaitForTransferOptions} from './transfer/wait-for-transfer.js'

import {basicAuthorization} from '../../core/basic-authorization.js'
import {readEnv} from '../../core/env.js'
import {extendResource, makeCtxClient} from '../../core/extend-resource.js'
import {combineSignals, withSignal} from '../../core/with-signal.js'
import {requestWithTimeout} from '../../utils/request-with-timeout.js'
import {resolvePgDatabase} from './internal/resolve-pg-database.js'
import {TransferFailedError, TransferTimeoutError, waitForTransfer} from './transfer/wait-for-transfer.js'

const DEFAULT_CREDENTIAL_LOOKUP_TIMEOUT_MS = 10_000
const MAX_CREDENTIAL_LOOKUP_TIMEOUT_MS = 60_000
const CREDENTIAL_LOOKUP_TIMED_OUT = {timedOut: true} as const

export type DatabaseCopyEndpoint = {
  /** Confirmation value and readable endpoint name used by the CLI. */
  confirm: string
  /** Present for Heroku Postgres attachments; absent for a raw external URL. */
  database?: PublicResolvedPgDatabaseWithAttachment
  name: string
}

type PublicResolvedPgDatabaseWithAttachment = {
  addon: Pick<ResolvedPgDatabaseWithAttachment['addon'], 'app' | 'id' | 'name' | 'plan'>
  attachment: Pick<ResolvedPgDatabaseWithAttachment['attachment'], 'app' | 'config_vars' | 'created_at' | 'id' | 'name' | 'namespace' | 'updated_at'> & {
    addon: Pick<ResolvedPgDatabaseWithAttachment['attachment']['addon'], 'app' | 'id' | 'name' | 'plan'>
  }
}

type ResolvedCopyEndpoint = {
  confirm: string
  database?: ResolvedPgDatabaseWithAttachment
  name: string
  url: string
}

type CopySecrets = {
  databaseUrls: string[]
  literalValues: string[]
}

/**
 * Progress callbacks are non-blocking: synchronous failures and async
 * rejections observed by transfer completion are reported, while pending
 * hooks cannot delay polling. Later rejections are handled but excluded from
 * the returned warning snapshot. `beforeCopy` is awaited. Credential lookup
 * finishes (or times out) after `beforeCopy` and before transfer creation.
 */
export type DatabaseCopyOptions = WaitForTransferOptions & {
  /** Runs after resolving and validating both endpoints, before transfer creation. */
  beforeCopy?: (preview: {source: DatabaseCopyEndpoint; target: DatabaseCopyEndpoint}) => Promise<void> | void
  /** Progress hooks around transfer creation. */
  copyPoller?: Poller<{source: DatabaseCopyEndpoint; target: DatabaseCopyEndpoint}>
  /** Maximum time to wait for the advisory source credential lookup. Must be positive; capped at 60 seconds. Defaults to 10 seconds. */
  credentialLookupTimeoutMs?: number
  /** Legacy pg:copy token for Basic-auth source credential lookup only. */
  credentialToken?: string
  /** Runs after source credential lookup settles or times out, before transfer creation; awaited up to the credential lookup timeout. */
  onCredentialsChecked?: (result: Pick<DatabaseCopyResult, 'credentialCount' | 'hasAdditionalCredentials'> & {warning?: string}) => Promise<void> | void
  /**
   * Called after each transfer poll. Async work is observed for rejection but
   * never awaited, so a slow progress callback cannot delay timeout or abort.
   */
  onPoll?: (transfer: TransferInfoByAppResult | undefined) => void
  /** Progress hooks around transfer polling. */
  waitPoller?: Poller<TransferCreateResult>
}

export type DatabaseCopyResult = {
  /** Number of credentials found on a Heroku source; undefined for external sources. */
  credentialCount?: number
  /** True when the CLI should display the additional-credentials warning. */
  hasAdditionalCredentials: boolean
  source: DatabaseCopyEndpoint
  target: DatabaseCopyEndpoint
  transfer: TransferInfoByAppResult
  /**
   * Non-fatal credential lookup and progress callback failures observed before
   * transfer completion. Later async rejections are handled but excluded; this
   * snapshot is not mutated after return.
   */
  warnings: string[]
}

/** A post-create failure that retains the remote transfer identity and outcome. */
export class DatabaseCopyTransferError extends Error {
  public declare readonly transfer?: TransferInfoByAppResult
  public readonly transferId: string

  constructor(
    transferId: string,
    message: string,
    transfer?: TransferInfoByAppResult,
    options: {aborted?: boolean; cause?: Error} = {},
  ) {
    super(`Database copy transfer '${transferId}' was created, but ${message}`, {cause: options.cause})
    this.name = options.aborted || options.cause?.name === 'AbortError' ? 'AbortError' : 'DatabaseCopyTransferError'
    this.transferId = transferId
    if (transfer !== undefined) this.transfer = transfer
  }
}

/**
 * Resolve classic `pg:copy` inputs, create a v11 transfer, and wait for it to
 * finish. Raw PostgreSQL URLs remain supported alongside the attachment
 * resolver's identities (attachment/config-var names, attachment UUIDs, and
 * globally unique add-on names, optionally qualified as `app::identity`), but at least
 * one endpoint must resolve to a Heroku Postgres attachment. The SDK's data
 * service defaults to `https://api.data.heroku.com` to preserve CLI routing
 * when neither environment variable is set. The SDK validates
 * `HEROKU_DATA_HOST` first, then `HEROKU_POSTGRESQL_HOST`; the first non-empty
 * value wins. An explicit
 * `clientOptionsByService.data.baseUrl` overrides environment routing. Data
 * service host validation applies to environment-derived values; explicit base
 * URLs are the caller's responsibility and must be trusted HTTPS hosts because
 * requests carry Heroku credentials. Credential lookup uses the data client's normal Bearer-token auth unless
 * `credentialToken` is provided. That optional token is used only for the
 * legacy Basic-auth credential lookup; transfer and polling requests always
 * use the normal data client.
 */
// eslint-disable-next-line complexity, max-params
export async function copyDatabase(
  ctx: Pick<ResourceCtx, 'data' | 'makeClient' | 'operationSignal' | 'platform'>,
  appIdentity: string,
  sourceIdentity: string,
  targetIdentity: string,
  options: DatabaseCopyOptions = {},
): Promise<DatabaseCopyResult> {
  const {
    beforeCopy,
    copyPoller,
    credentialLookupTimeoutMs = DEFAULT_CREDENTIAL_LOOKUP_TIMEOUT_MS,
    credentialToken,
    onCredentialsChecked,
    signal: callerSignal,
    waitPoller,
    ...waitOptions
  } = options
  if (!Number.isFinite(credentialLookupTimeoutMs) || credentialLookupTimeoutMs <= 0) {
    throw new RangeError('credentialLookupTimeoutMs must be a finite positive number')
  }

  const lookupTimeoutMs = Math.min(credentialLookupTimeoutMs, MAX_CREDENTIAL_LOOKUP_TIMEOUT_MS)
  const signal = combineSignals(ctx.operationSignal, callerSignal)

  let source: ResolvedCopyEndpoint | undefined
  let target: ResolvedCopyEndpoint | undefined

  const secrets: CopySecrets = {
    databaseUrls: [sourceIdentity, targetIdentity].filter(identity => /^postgres:\/\//.test(identity)),
    literalValues: [],
  }
  if (credentialToken !== undefined) {
    const authorization = basicAuthorization('', credentialToken)
    secrets.literalValues.push(credentialToken, encodeURIComponent(credentialToken), authorization, authorization.slice('Basic '.length))
  }

  throwIfAborted(signal, secrets)

  const resolvedEndpoints = await Promise.allSettled([
    resolveCopyEndpoint(ctx, appIdentity, sourceIdentity, signal),
    resolveCopyEndpoint(ctx, appIdentity, targetIdentity, signal),
  ])
  for (const result of resolvedEndpoints) {
    if (result.status === 'fulfilled') secrets.databaseUrls.push(result.value.url)
  }

  const failedResolution = resolvedEndpoints.find(result => result.status === 'rejected')
  if (failedResolution?.status === 'rejected') {
    throw safeError(failedResolution.reason, secrets)
  }

  if (resolvedEndpoints[0].status === 'fulfilled') source = resolvedEndpoints[0].value
  if (resolvedEndpoints[1].status === 'fulfilled') target = resolvedEndpoints[1].value

  if (!source || !target) throw new Error('Could not resolve database copy endpoints')

  const resolvedSource = source
  const resolvedTarget = target

  if (resolvedSource.url === resolvedTarget.url) {
    throw new Error('Cannot copy database onto itself')
  }

  if (!resolvedSource.database && !resolvedTarget.database) {
    throw new Error('Heroku PostgreSQL database must be source or target')
  }

  const progress = {
    source: publicEndpoint(resolvedSource, secrets),
    target: publicEndpoint(resolvedTarget, secrets),
  }

  try {
    await beforeCopy?.(progress)
  } catch (error) {
    throw safeError(error, secrets)
  }

  throwIfAborted(signal, secrets)
  const ancillaryErrors: {error: Error; stage: string}[] = []
  const warnings: string[] = []
  const recordAncillaryError = (stage: string, error: unknown) => {
    const sanitized = safeError(error, secrets)
    ancillaryErrors.push({error: sanitized, stage})
    warnings.push(`${stage} failed: ${sanitized.message}`)
  }

  const credentialResult = await getCredentialCount()
  throwIfAborted(signal, secrets)
  let credentialCount: number | undefined
  let credentialWarning: string | undefined
  if ('error' in credentialResult) {
    recordAncillaryError('source credential lookup', credentialResult.error)
    credentialWarning = warnings.at(-1)
  } else {
    credentialCount = credentialResult.count
  }

  try {
    const callbackResult = await requestWithTimeout(
      async () => onCredentialsChecked?.({
        credentialCount,
        hasAdditionalCredentials: (credentialCount ?? 0) > 1,
        ...(credentialWarning ? {warning: credentialWarning} : {}),
      }),
      {signal, timeoutMs: lookupTimeoutMs, timeoutValue: CREDENTIAL_LOOKUP_TIMED_OUT},
    )
    if (callbackResult === CREDENTIAL_LOOKUP_TIMED_OUT) {
      recordAncillaryError('credential callback', new Error(`credential callback timed out after ${lookupTimeoutMs}ms`))
    }
  } catch (error) {
    recordAncillaryError('credential callback', error)
  }

  throwIfAborted(signal, secrets)

  const copyStartErrors: unknown[] = []
  let recordCopyStartError = (error: unknown): void => {
    copyStartErrors.push(error)
  }

  try {
    const result = copyPoller?.onStart?.(progress)
    if (result && typeof (result as PromiseLike<unknown>).then === 'function') {
      (result as PromiseLike<unknown>).then(undefined, error => recordCopyStartError(error))
    }
  } catch (error) {
    recordCopyStartError(error)
  }

  const herokuDatabase = resolvedTarget.database ?? resolvedSource.database!
  const data = withSignal(ctx.data, signal)
  // The classic v11 pg:copy wire body omits from_type/to_type. Keep that
  // request shape while dispatching through the generated transfer route.
  const body: Omit<TransferCreateOpts, 'from_type' | 'to_type'> = {
    // eslint-disable-next-line camelcase
    from_name: resolvedSource.name,
    // eslint-disable-next-line camelcase
    from_url: resolvedSource.url,
    // eslint-disable-next-line camelcase
    to_name: resolvedTarget.name,
    // eslint-disable-next-line camelcase
    to_url: resolvedTarget.url,
  }
  // The generated schema marks the types required, but the classic v11 copy
  // API accepts and historically receives this body without either field.
  let created: TransferCreateResult
  try {
    created = await data.transfer.create(herokuDatabase.addon.id, body as TransferCreateOpts)
  } catch (error) {
    throw safeError(error, secrets)
  }

  const transferId = created.uuid
  secrets.databaseUrls.push(resolvedSource.url, resolvedTarget.url)

  const safeCreated = sanitizeTransfer(created, secrets)

  recordCopyStartError = (error: unknown): void => recordAncillaryError('copy progress callback', error)

  for (const error of copyStartErrors.splice(0)) recordCopyStartError(error)

  // Begin observing the remote transfer before progress callbacks can fail.
  // Their errors are reported only after polling reaches an outcome, so they
  // cannot leave a created transfer unobserved.
  runAncillaryCallback(() => waitPoller?.onStart?.(safeCreated as TransferCreateResult), error => recordAncillaryError('wait progress callback', error))
  const waitOutcome = waitForTransfer(ctx, herokuDatabase.addon.app.name || appIdentity, transferId, {
    ...waitOptions,
    onPoll: waitOptions.onPoll
      ? transfer => runAncillaryCallback(
        () => waitOptions.onPoll?.(sanitizeTransfer(transfer, secrets)),
        error => recordAncillaryError('transfer poll callback', error),
      )
      : undefined,
    signal: callerSignal,
  }).then(
    transfer => {
      if (!signal?.aborted) {
        // Observe a settled stop-hook rejection before publishing the completed
        // outcome, without waiting for a hook that remains pending.
        runAncillaryCallback(
          () => waitPoller?.onStop?.(safeCreated as TransferCreateResult),
          error => recordAncillaryError('wait progress callback', error),
        )
      }

      return {transfer}
    },
    error => ({error}),
  )

  runAncillaryCallback(() => copyPoller?.onStop?.(progress), error => recordAncillaryError('copy progress callback', error))

  const outcome = await waitOutcome

  if ('error' in outcome) {
    if (signal?.aborted) {
      const abortError = safeError(signal.reason ?? Object.assign(new Error('The operation was aborted'), {name: 'AbortError'}), secrets)
      throw new DatabaseCopyTransferError(transferId, 'waiting was aborted', undefined, {aborted: true, cause: abortError})
    }

    if (outcome.error instanceof TransferFailedError) {
      if (ancillaryErrors.length > 0) {
        outcome.error.ancillaryErrors = ancillaryErrors.map(({error, stage}) => `${stage} failed: ${error.message}`)
        outcome.error.message = `${outcome.error.message}; ${describeAncillaryErrors(ancillaryErrors)}`
      }

      throw safeError(outcome.error, secrets)
    }

    if (outcome.error instanceof TransferTimeoutError) {
      if (ancillaryErrors.length > 0) {
        outcome.error.ancillaryErrors = ancillaryErrors.map(({error, stage}) => `${stage} failed: ${error.message}`)
        outcome.error.message = `${outcome.error.message}; ${describeAncillaryErrors(ancillaryErrors)}`
      }

      throw safeError(outcome.error, secrets)
    }

    const waitError = safeError(outcome.error, secrets)
    const ancillaryMessage = ancillaryErrors.length > 0 ? `; ${describeAncillaryErrors(ancillaryErrors)}` : ''
    const aborted = signal?.aborted || waitError.name === 'AbortError'
    throw new DatabaseCopyTransferError(
      transferId,
      `transfer observation failed: ${waitError.message}${ancillaryMessage}`,
      aborted ? undefined : safeCreated as TransferInfoByAppResult,
      {aborted, cause: waitError},
    )
  }

  const transfer = sanitizeTransfer(outcome.transfer, secrets)
  if (signal?.aborted) {
    const abortError = safeError(signal.reason ?? Object.assign(new Error('The operation was aborted'), {name: 'AbortError'}), secrets)
    throw new DatabaseCopyTransferError(transferId, 'waiting was aborted', undefined, {aborted: true, cause: abortError})
  }

  const hasAdditionalCredentials = (credentialCount ?? 0) > 1
  return {
    credentialCount,
    hasAdditionalCredentials,
    source: publicEndpoint(resolvedSource, secrets),
    target: publicEndpoint(resolvedTarget, secrets),
    transfer,
    // Callback rejections can arrive after this result is returned. Keep their
    // rejection handlers attached, but do not let them mutate the public result.
    warnings: [...warnings],
  }

  async function getCredentialCount(): Promise<{count: number | undefined} | {error: unknown}> {
    try {
      if (!resolvedSource.database) return {count: undefined}
      const lookup = await requestWithTimeout(
        async requestSignal => {
          const lookupSignal = combineSignals(signal, requestSignal)
          if (credentialToken !== undefined) {
            return listCredentialsWithToken(ctx, resolvedSource.database!.addon.name, credentialToken, lookupSignal)
          }

          return withSignal(ctx.data, lookupSignal).postgresDatabase
            .listCredentials(resolvedSource.database!.addon.id) as unknown as Promise<CredentialInfo[]>
        },
        {signal, timeoutMs: lookupTimeoutMs, timeoutValue: CREDENTIAL_LOOKUP_TIMED_OUT},
      )

      if ('timedOut' in lookup) {
        return {error: new Error(`credential lookup timed out after ${lookupTimeoutMs}ms`)}
      }

      return {count: lookup.length}
    } catch (error) {
      return {error}
    }
  }
}

function publicEndpoint(endpoint: ResolvedCopyEndpoint, secrets: CopySecrets): DatabaseCopyEndpoint {
  const {confirm: endpointConfirm, database, name, url} = endpoint
  const rawUrl = new URL(url)
  const confirm = database ? endpointConfirm : rawUrl.pathname.slice(1) || rawUrl.hostname

  return sanitizeTransfer({
    confirm,
    ...(database ? {database: publicDatabase(database)} : {}),
    name,
  }, secrets)
}

function publicDatabase(database: ResolvedPgDatabaseWithAttachment): PublicResolvedPgDatabaseWithAttachment {
  const addon = projectAddon(database.addon)
  const {attachment} = database

  return {
    addon,
    attachment: {
      addon: projectAddon(attachment.addon),
      app: {id: attachment.app.id, name: attachment.app.name},
      // eslint-disable-next-line camelcase
      config_vars: [...attachment.config_vars],
      // eslint-disable-next-line camelcase
      created_at: attachment.created_at,
      id: attachment.id,
      name: attachment.name,
      namespace: attachment.namespace,
      // eslint-disable-next-line camelcase
      updated_at: attachment.updated_at,
    },
  }
}

function projectAddon(addon: ResolvedPgDatabaseWithAttachment['addon']): PublicResolvedPgDatabaseWithAttachment['addon'] {
  return {
    app: {id: addon.app.id, name: addon.app.name},
    id: addon.id,
    name: addon.name,
    plan: {
      ...(addon.plan.id ? {id: addon.plan.id} : {}),
      name: addon.plan.name,
    },
  }
}

function runAncillaryCallback(callback: () => unknown, onError: (error: unknown) => void): void {
  const reportError = (error: unknown) => {
    try {
      onError(error)
    } catch {
      // Ancillary callback failures must never interrupt transfer observation.
    }
  }

  try {
    const result = callback()
    if (result && typeof (result as PromiseLike<unknown>).then === 'function') {
      (result as PromiseLike<unknown>).then(undefined, reportError)
    }
  } catch (error) {
    reportError(error)
  }
}

function sanitizeTransfer<T>(value: T, secrets: CopySecrets): T {
  return sanitizeValue(value, secrets, new WeakMap())
}

function sanitizeValue<T>(value: T, secrets: CopySecrets, seen: WeakMap<object, unknown>): T {
  if (typeof value === 'string') {
    return redactKnownSecrets(value, secrets) as T
  }

  if (value instanceof Error) {
    return sanitizeError(value, secrets, seen) as T
  }

  if (Array.isArray(value)) {
    if (seen.has(value)) return seen.get(value) as T
    const sanitized: unknown[] = []
    seen.set(value, sanitized)
    for (const item of value) sanitized.push(sanitizeValue(item, secrets, seen))
    return sanitized as T
  }

  if (value && typeof value === 'object') {
    if (value instanceof URL) return redactKnownSecrets(value.toString(), secrets) as T
    if (seen.has(value)) return seen.get(value) as T
    const sanitized = Object.create(Object.getPrototypeOf(value)) as Record<PropertyKey, unknown>
    seen.set(value, sanitized)
    for (const key of Reflect.ownKeys(value)) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key)
      if (descriptor?.enumerable && 'value' in descriptor) {
        Object.defineProperty(sanitized, key, {
          ...descriptor,
          value: isDatabaseUrlProperty(key) ? 'postgres://[REDACTED]' : sanitizeValue(descriptor.value, secrets, seen),
        })
      }
    }

    return sanitized as T
  }

  return value
}

function safeError(error: unknown, secrets: CopySecrets): Error {
  const source = error instanceof Error ? error : new Error(String(error), {cause: error})
  return sanitizeError(source, secrets, new WeakMap())
}

function sanitizeError(error: Error, secrets: CopySecrets, seen: WeakMap<object, unknown>): Error {
  if (seen.has(error)) return seen.get(error) as Error
  const safe = new Error('Sanitized error')
  Object.setPrototypeOf(safe, Object.getPrototypeOf(error))
  seen.set(error, safe)

  for (const key of Reflect.ownKeys(error)) {
    const descriptor = Object.getOwnPropertyDescriptor(error, key)
    if (!descriptor) continue
    if (!descriptor.enumerable && key !== 'message' && key !== 'name' && key !== 'stack' && key !== 'cause') continue

    let fieldValue: unknown
    try {
      fieldValue = 'value' in descriptor ? descriptor.value : Reflect.get(error, key)
    } catch {
      fieldValue = '[unavailable]'
    }

    let value: unknown
    if (isDatabaseUrlProperty(key)) value = 'postgres://[REDACTED]'
    else if (key === 'message' || key === 'name' || key === 'stack') value = redactKnownSecrets(String(fieldValue), secrets)
    else value = sanitizeValue(fieldValue, secrets, seen)
    Object.defineProperty(safe, key, {
      configurable: true,
      enumerable: descriptor.enumerable ?? false,
      value,
      writable: true,
    })
  }

  if (!Object.hasOwn(safe, 'name')) {
    Object.defineProperty(safe, 'name', {configurable: true, value: redactKnownSecrets(error.name, secrets), writable: true})
  }

  return safe
}

function describeAncillaryErrors(errors: {error: Error; stage: string}[]): string {
  return errors.map(({error, stage}) => `${stage} failed: ${error.message}`).join('; ')
}

function redactKnownSecrets(value: string, secrets: CopySecrets): string {
  let redacted = value
  for (const url of [...new Set(secrets.databaseUrls)].filter(Boolean).sort((left, right) => right.length - left.length)) {
    redacted = redacted.replaceAll(url, redactUrl(url))
  }

  for (const secret of [...new Set(secrets.literalValues)].filter(Boolean).sort((left, right) => right.length - left.length)) {
    redacted = redacted.replaceAll(secret, 'REDACTED')
  }

  return redacted
}

function redactUrl(value: string): string {
  try {
    const url = new URL(value)
    return `${url.protocol}//[REDACTED]`
  } catch {
    return 'postgres://[REDACTED]'
  }
}

function isDatabaseUrlProperty(key: PropertyKey): boolean {
  return key === 'from_url' || key === 'to_url'
}

function throwIfAborted(signal: AbortSignal | undefined, secrets: CopySecrets): void {
  if (signal?.aborted) throw safeError(signal.reason ?? Object.assign(new Error('The operation was aborted'), {name: 'AbortError'}), secrets)
}

async function listCredentialsWithToken(
  ctx: Pick<ResourceCtx, 'makeClient'>,
  addonName: string,
  credentialToken: string,
  signal?: AbortSignal,
): Promise<CredentialInfo[]> {
  const client = makeCtxClient(ctx, 'data', {
    headers: {Authorization: basicAuthorization('', credentialToken)},
    token() {},
  })
  const response = await client.get(`/postgres/v0/databases/${encodeURIComponent(addonName)}/credentials`, {signal})
  return await response.json() as CredentialInfo[]
}

async function resolveCopyEndpoint(
  ctx: Pick<ResourceCtx, 'data' | 'makeClient' | 'platform'>,
  appIdentity: string,
  identity: string,
  signal?: AbortSignal,
): Promise<ResolvedCopyEndpoint> {
  if (/^postgres:\/\//.test(identity)) {
    const url = new URL(identity)
    const databaseName = url.pathname.slice(1)
    const port = url.port || readEnv('PGPORT') || (url.hostname && '5432')
    const host = `${url.hostname}:${port}`

    return {
      confirm: databaseName || url.hostname,
      name: databaseName ? `database ${databaseName} on ${host}` : `database on ${host}`,
      url: identity,
    }
  }

  const resolved = await resolvePgDatabase(ctx, appIdentity, {
    includeAttachment: true,
    input: identity,
    signal,
  })
  const {attachment} = resolved
  const config = await withSignal(ctx.platform, signal).configVar.infoForApp(attachment.app.name)
  const formattedConfig = Object.fromEntries(Object.entries(config).map(([key, value]) => [key.toUpperCase(), value]))
  const connectionVar = attachment.config_vars
    .filter(name => formattedConfig[name.toUpperCase()]?.startsWith('postgres://'))
    .find(name => name.toUpperCase() === `${attachment.name.toUpperCase()}_URL`)
    ?? attachment.config_vars.find(name => formattedConfig[name.toUpperCase()]?.startsWith('postgres://'))
  const url = connectionVar ? formattedConfig[connectionVar.toUpperCase()] : undefined

  if (!url) {
    throw new Error(`Database URL not found for attachment ${attachment.name}`)
  }

  const name = attachment.name
    .replace(/^HEROKU_POSTGRESQL_/, '')
    .replace(/_URL$/, '')

  return {
    confirm: name,
    database: resolved,
    name,
    url,
  }
}

export const databaseCopyExtensions = extendResource('data', 'database', ctx => ({
  copyForApp: (
    appIdentity: string,
    sourceIdentity: string,
    targetIdentity: string,
    options?: DatabaseCopyOptions,
  ) => copyDatabase(ctx, appIdentity, sourceIdentity, targetIdentity, options),
}))
