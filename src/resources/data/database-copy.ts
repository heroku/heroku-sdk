import type {TransferCreateOpts, TransferCreateResult, TransferInfoByAppResult} from '@heroku/types/data'

import type {ResourceCtx} from '../../core/extend-resource.js'
import type {Poller} from '../../utils/poller.js'
import type {ResolvedPgDatabaseWithAttachment} from './internal/resolve-pg-database.js'
import type {CredentialInfo} from './postgres-database.js'
import type {WaitForTransferOptions} from './transfer/wait-for-transfer.js'

import {extendResource, makeCtxClient} from '../../core/extend-resource.js'
import {combineSignals, withSignal} from '../../core/with-signal.js'
import {resolvePgDatabase} from './internal/resolve-pg-database.js'
import {TransferFailedError, TransferTimeoutError, waitForTransfer} from './transfer/wait-for-transfer.js'

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

/**
 * Progress callbacks are non-blocking: async rejections settled by outcome are
 * reported, while pending hooks cannot delay polling. `beforeCopy` is awaited.
 */
export type DatabaseCopyOptions = WaitForTransferOptions & {
  /** Runs after resolving and validating both endpoints, before transfer creation. */
  beforeCopy?: (preview: {source: DatabaseCopyEndpoint; target: DatabaseCopyEndpoint}) => Promise<void> | void
  /** Progress hooks around transfer creation. */
  copyPoller?: Poller<{source: DatabaseCopyEndpoint; target: DatabaseCopyEndpoint}>
  /** Legacy pg:copy token for Basic-auth source credential lookup only. */
  credentialToken?: string
  /** Runs after source credential lookup and before waiting, so callers can render the CLI warning. */
  onCredentialsChecked?: (result: Pick<DatabaseCopyResult, 'credentialCount' | 'hasAdditionalCredentials'>) => Promise<void> | void
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
 * service defaults to `https://postgres-api.heroku.com`; consumers matching
 * the CLI's `HEROKU_DATA_HOST`/`HEROKU_POSTGRESQL_HOST` routing should set
 * `clientOptionsByService.data.baseUrl` to the CLI host (by default
 * `https://api.data.heroku.com`). Credential lookup uses the data client's
 * normal Bearer-token auth unless `credentialToken` is provided. That optional
 * token is used only for the legacy Basic-auth credential lookup; transfer and
 * polling requests always use the normal data client. Do not point an
 * authenticated client at an untrusted host.
 */
// eslint-disable-next-line complexity, max-params
export async function copyDatabase(
  ctx: Pick<ResourceCtx, 'data' | 'makeClient' | 'operationSignal' | 'platform'>,
  appIdentity: string,
  sourceIdentity: string,
  targetIdentity: string,
  options: DatabaseCopyOptions = {},
): Promise<DatabaseCopyResult> {
  const {beforeCopy, copyPoller, credentialToken, onCredentialsChecked, signal: callerSignal, waitPoller, ...waitOptions} = options
  const signal = combineSignals(ctx.operationSignal, callerSignal)
  throwIfAborted(signal, [sourceIdentity, targetIdentity])

  let source: ResolvedCopyEndpoint | undefined
  let target: ResolvedCopyEndpoint | undefined
  const secrets = [sourceIdentity, targetIdentity]
  const resolvedEndpoints = await Promise.allSettled([
    resolveCopyEndpoint(ctx, appIdentity, sourceIdentity, signal),
    resolveCopyEndpoint(ctx, appIdentity, targetIdentity, signal),
  ])
  for (const result of resolvedEndpoints) {
    if (result.status === 'fulfilled') secrets.push(result.value.url)
  }

  const failedResolution = resolvedEndpoints.find(result => result.status === 'rejected')
  if (failedResolution?.status === 'rejected') {
    throw safeError(failedResolution.reason, [sourceIdentity, targetIdentity, ...secrets])
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
    throw safeError(error, [resolvedSource.url, resolvedTarget.url])
  }

  throwIfAborted(signal, [resolvedSource.url, resolvedTarget.url])
  const copyStartErrors: unknown[] = []
  let recordCopyStartError = (error: unknown): void => {
    copyStartErrors.push(error)
  }

  try {
    const result = copyPoller?.onStart?.(progress)
    if (result && typeof (result as PromiseLike<unknown>).then === 'function') {
      Promise.resolve(result).catch(error => recordCopyStartError(error))
    }
  } catch (error) {
    throw safeError(error, [resolvedSource.url, resolvedTarget.url])
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
    throw safeError(error, [resolvedSource.url, resolvedTarget.url])
  }

  const transferId = created.uuid
  secrets.push(resolvedSource.url, resolvedTarget.url)
  if (credentialToken !== undefined) {
    const basicAuthorization = `Basic ${Buffer.from(`:${credentialToken}`).toString('base64')}`
    secrets.push(`https://credential.invalid/?token=${encodeURIComponent(credentialToken)}&authorization=${encodeURIComponent(basicAuthorization)}`)
  }

  const safeCreated = sanitizeTransfer(created, secrets)
  const ancillaryErrors: {error: Error; stage: string}[] = []
  const recordAncillaryError = (stage: string, error: unknown) => {
    ancillaryErrors.push({error: safeError(error, secrets), stage})
  }

  recordCopyStartError = (error: unknown): void => {
    recordAncillaryError('copy progress callback', error)
  }

  for (const error of copyStartErrors.splice(0)) recordCopyStartError(error)

  // Begin observing the remote transfer before optional credential lookup or
  // caller callbacks can fail. Their errors are reported only after polling
  // reaches an outcome, so they cannot leave a created transfer unobserved.
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
    transfer => ({transfer}),
    error => ({error}),
  )

  await Promise.resolve()
  runAncillaryCallback(() => copyPoller?.onStop?.(progress), error => recordAncillaryError('copy progress callback', error))
  await Promise.resolve()

  let credentialCount: number | undefined
  let credentialLookupNeeded = true
  let credentialLookupSettled = false
  const credentialController = new AbortController()
  const abortCredentialLookup = () => credentialController.abort(signal?.reason)
  if (signal?.aborted) abortCredentialLookup()
  else signal?.addEventListener('abort', abortCredentialLookup, {once: true})

  const credentialData = withSignal(ctx.data, combineSignals(signal, credentialController.signal))

  let settleCredentialLookup!: () => void
  const credentialOutcome = new Promise<void>(resolve => {
    settleCredentialLookup = resolve
  })
  const startCredentialLookup = () => {
    getCredentialCount().then(result => {
      if (credentialLookupNeeded) {
        if ('error' in result) recordAncillaryError('source credential lookup', result.error)
        else {
          credentialCount = result.count
          runAncillaryCallback(
            () => onCredentialsChecked?.({credentialCount, hasAdditionalCredentials: (credentialCount ?? 0) > 1}),
            error => recordAncillaryError('credential callback', error),
          )
        }
      }
    }).catch(error => {
      if (credentialLookupNeeded) recordAncillaryError('source credential lookup', error)
    }).then(() => {
      credentialLookupSettled = true
      settleCredentialLookup()
    }).catch(() => {
      credentialLookupSettled = true
      settleCredentialLookup()
    })
  }

  startCredentialLookup()

  const firstOutcome = await Promise.race([
    waitOutcome.then(result => ({kind: 'transfer' as const, result})),
    credentialOutcome.then(() => ({kind: 'credentials' as const})),
  ])
  const outcome = firstOutcome.kind === 'transfer' ? firstOutcome.result : await waitOutcome

  await Promise.resolve()

  if (!credentialLookupSettled) {
    credentialLookupNeeded = false
    if (!credentialController.signal.aborted) credentialController.abort()
  }

  signal?.removeEventListener('abort', abortCredentialLookup)
  if (credentialLookupSettled) await credentialOutcome

  if (!('error' in outcome) && !signal?.aborted) {
    // onStop is an observer: it must not change the completed transfer outcome.
    runAncillaryCallback(() => waitPoller?.onStop?.(safeCreated as TransferCreateResult), () => {})
  }

  // Let callbacks already settled with the transfer outcome report their error,
  // but never wait for a callback that remains pending.
  await Promise.resolve()
  for (const error of copyStartErrors.splice(0)) recordAncillaryError('copy progress callback', error)

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

  if (ancillaryErrors.length > 0) {
    throw new DatabaseCopyTransferError(
      transferId,
      describeAncillaryErrors(ancillaryErrors),
      transfer,
      {cause: ancillaryErrors[0].error},
    )
  }

  const hasAdditionalCredentials = (credentialCount ?? 0) > 1
  return {
    credentialCount,
    hasAdditionalCredentials,
    source: publicEndpoint(resolvedSource, secrets),
    target: publicEndpoint(resolvedTarget, secrets),
    transfer,
  }

  async function getCredentialCount(): Promise<{count: number | undefined} | {error: unknown}> {
    try {
      if (!resolvedSource.database) return {count: undefined}
      const credentialList = credentialToken === undefined
        ? await credentialData.postgresDatabase.listCredentials(resolvedSource.database.addon.id) as unknown as CredentialInfo[]
        : await listCredentialsWithToken(
          ctx,
          resolvedSource.database.addon.name,
          credentialToken,
          combineSignals(signal, credentialController.signal),
        )
      return {count: credentialList.length}
    } catch (error) {
      return {error}
    }
  }
}

function publicEndpoint(endpoint: ResolvedCopyEndpoint, secrets: string[]): DatabaseCopyEndpoint {
  const {confirm: endpointConfirm, database, name, url} = endpoint
  const confirm = database ? endpointConfirm : new URL(url).hostname

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
      Promise.resolve(result).then(undefined, reportError)
    }
  } catch (error) {
    reportError(error)
  }
}

function sanitizeTransfer<T>(value: T, secrets: string[]): T {
  return sanitizeValue(value, secrets, new WeakMap())
}

function sanitizeValue<T>(value: T, secrets: string[], seen: WeakMap<object, unknown>): T {
  if (typeof value === 'string') {
    return redactDatabaseUrls(value, secrets) as T
  }

  if (value instanceof Error) {
    return sanitizeError(value, collectSecretsFrom(value, secrets), seen) as T
  }

  if (Array.isArray(value)) {
    if (seen.has(value)) return seen.get(value) as T
    const sanitized: unknown[] = []
    seen.set(value, sanitized)
    for (const item of value) sanitized.push(sanitizeValue(item, secrets, seen))
    return sanitized as T
  }

  if (value && typeof value === 'object') {
    if (value instanceof URL) return redactDatabaseUrls(value.toString(), secrets) as T
    if (seen.has(value)) return seen.get(value) as T
    const sanitized = Object.create(Object.getPrototypeOf(value)) as Record<PropertyKey, unknown>
    seen.set(value, sanitized)
    for (const key of Reflect.ownKeys(value)) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key)
      if (descriptor?.enumerable && 'value' in descriptor) {
        Object.defineProperty(sanitized, key, {
          ...descriptor,
          value: isSensitiveProperty(key) ? 'REDACTED' : sanitizeValue(descriptor.value, secrets, seen),
        })
      }
    }

    return sanitized as T
  }

  return value
}

function safeError(error: unknown, secrets: string[]): Error {
  const source = error instanceof Error ? error : new Error(String(error), {cause: error})
  return sanitizeError(source, collectSecretsFrom(source, secrets), new WeakMap())
}

function sanitizeError(error: Error, secrets: string[], seen: WeakMap<object, unknown>): Error {
  if (seen.has(error)) return seen.get(error) as Error
  const allSecrets = collectSecretsFrom(error, secrets)
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
    if (isSensitiveProperty(key)) value = 'REDACTED'
    else if (key === 'message' || key === 'name' || key === 'stack') value = redactDatabaseUrls(String(fieldValue), allSecrets)
    else value = sanitizeValue(fieldValue, allSecrets, seen)
    Object.defineProperty(safe, key, {
      configurable: true,
      enumerable: descriptor.enumerable ?? false,
      value,
      writable: true,
    })
  }

  if (!Object.hasOwn(safe, 'name')) {
    Object.defineProperty(safe, 'name', {configurable: true, value: redactDatabaseUrls(error.name, allSecrets), writable: true})
  }

  return safe
}

function describeAncillaryErrors(errors: {error: Error; stage: string}[]): string {
  return errors.map(({error, stage}) => `${stage} failed: ${error.message}`).join('; ')
}

function redactDatabaseUrls(value: string, secrets: string[]): string {
  let redacted = value
  redacted = redacted.replaceAll(/[a-z][a-z\d+.-]*:\/\/[^\s"'<>]+/gi, match => {
    const trailingPunctuation = match.match(/[,.;!?)]*$/)?.[0] ?? ''
    const url = trailingPunctuation ? match.slice(0, -trailingPunctuation.length) : match
    return `${redactUrl(url)}${trailingPunctuation}`
  })

  for (const secret of [...secrets].filter(value => value.includes('://')).sort((left, right) => right.length - left.length)) {
    redacted = redacted.replaceAll(secret, redactPostgresUrl(secret))
  }

  const sensitiveValues = collectSensitiveValues(secrets)
  for (const secret of [...sensitiveValues].sort((left, right) => right.length - left.length)) {
    const escaped = secret.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`)
    redacted = redacted.replaceAll(new RegExp(`(^|[^\\p{L}\\p{N}])${escaped}(?=$|[^\\p{L}\\p{N}])`, 'gu'), '$1REDACTED')
  }

  return redacted
}

function redactPostgresUrl(value: string): string {
  return redactUrl(value)
}

function redactUrl(value: string): string {
  try {
    const url = new URL(value)
    return `${url.protocol}//[REDACTED]`
  } catch {
    return 'postgres://[REDACTED]'
  }
}

function collectSensitiveValues(urls: string[]): string[] {
  const values = new Set<string>()
  const add = (value: string) => {
    if (!value) return
    values.add(value)
    try {
      const decoded = decodeURIComponent(value.replaceAll('+', ' '))
      if (decoded) values.add(decoded)
    } catch {
      // Malformed percent-encoding is still redacted in its raw form.
    }
  }

  for (const candidate of urls) collectSensitiveValuesFromUrl(candidate, add)

  return [...values]
}

function collectSensitiveValuesFromUrl(candidate: string, add: (value: string) => void): void {
  try {
    const url = new URL(candidate)
    const authority = candidate.match(/^[a-z][a-z\d+.-]*:\/\/([^/?#]*)/i)?.[1] ?? ''
    const rawUserInfo = authority.slice(0, authority.lastIndexOf('@'))
    if (rawUserInfo) {
      for (const component of rawUserInfo.split(':')) add(component)
    }

    add(url.username)
    add(url.password)

    for (const [key, value] of url.searchParams) {
      if (isSensitiveQueryParam(key)) add(value)
    }

    const rawQuery = candidate.split('?', 2)[1]?.split('#', 1)[0]
    if (rawQuery) {
      for (const parameter of rawQuery.split('&')) {
        const [rawKey, ...rawValue] = parameter.split('=')
        if (isSensitiveQueryParam(decodeQueryComponent(rawKey))) add(rawValue.join('='))
      }
    }
  } catch {
    // Non-URL identities do not contribute credential components.
  }
}

function collectSecretsFrom(value: unknown, secrets: string[], seen = new WeakSet<object>()): string[] {
  const candidates = [...secrets]
  visitForSecrets(value, candidates, seen)
  return [...new Set([...candidates, ...collectSensitiveValues(candidates)])]
}

function visitForSecrets(value: unknown, candidates: string[], seen: WeakSet<object>): void {
  if (typeof value === 'string') {
    candidates.push(...(value.match(/[a-z][a-z\d+.-]*:\/\/[^\s"'<>]+/gi) ?? []))
    return
  }

  if (!value || typeof value !== 'object' || seen.has(value)) return
  seen.add(value)
  if (value instanceof URL) {
    candidates.push(value.toString())
    return
  }

  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (descriptor && 'value' in descriptor) visitForSecrets(descriptor.value, candidates, seen)
  }
}

function decodeQueryComponent(value: string): string {
  try {
    return decodeURIComponent(value.replaceAll('+', ' '))
  } catch {
    return value
  }
}

function isSensitiveQueryParam(key: string): boolean {
  return /(?:pass(?:word)?|pwd|token|secret|credential|auth|user(?:name)?|(?:api|access|private)[_-]?key)/i.test(key)
}

function isSensitiveProperty(key: PropertyKey): boolean {
  return typeof key === 'string' && isSensitiveQueryParam(key)
}

function throwIfAborted(signal: AbortSignal | undefined, secrets: string[]): void {
  if (signal?.aborted) throw safeError(signal.reason ?? Object.assign(new Error('The operation was aborted'), {name: 'AbortError'}), secrets)
}

async function listCredentialsWithToken(
  ctx: Pick<ResourceCtx, 'makeClient'>,
  addonName: string,
  credentialToken: string,
  signal?: AbortSignal,
): Promise<CredentialInfo[]> {
  const client = makeCtxClient(ctx, 'data', {
    headers: {Authorization: `Basic ${Buffer.from(`:${credentialToken}`).toString('base64')}`},
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
    const port = url.port || process.env.PGPORT || (url.hostname && '5432')
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
  copy: (
    appIdentity: string,
    sourceIdentity: string,
    targetIdentity: string,
    options?: DatabaseCopyOptions,
  ) => copyDatabase(ctx, appIdentity, sourceIdentity, targetIdentity, options),
}))
