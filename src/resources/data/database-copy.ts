import type {TransferCreateOpts, TransferCreateResult, TransferInfoByAppResult} from '@heroku/types/data'

import type {ResourceCtx} from '../../core/extend-resource.js'
import type {Poller} from '../../utils/poller.js'
import type {ResolvedPgDatabaseWithAttachment} from './internal/resolve-pg-database.js'
import type {CredentialInfo} from './postgres-database.js'
import type {WaitForTransferOptions} from './transfer/wait-for-transfer.js'

import {extendResource, makeCtxClient} from '../../core/extend-resource.js'
import {withSignal} from '../../core/with-signal.js'
import {resolvePgDatabase} from './internal/resolve-pg-database.js'
import {waitForTransfer} from './transfer/wait-for-transfer.js'

export type DatabaseCopyEndpoint = {
  /** Confirmation value and readable endpoint name used by the CLI. */
  confirm: string
  /** Present for Heroku Postgres attachments; absent for a raw external URL. */
  database?: ResolvedPgDatabaseWithAttachment
  name: string
  url: string
}

export type DatabaseCopyOptions = WaitForTransferOptions & {
  /** Runs after resolving and validating both endpoints, before transfer creation. */
  beforeCopy?: (preview: {source: DatabaseCopyEndpoint; target: DatabaseCopyEndpoint}) => Promise<void> | void
  /** Progress hooks around transfer creation. */
  copyPoller?: Poller<{source: DatabaseCopyEndpoint; target: DatabaseCopyEndpoint}>
  /** Legacy pg:copy token for Basic-auth source credential lookup only. */
  credentialToken?: string
  /** Runs after source credential lookup and before waiting, so callers can render the CLI warning. */
  onCredentialsChecked?: (result: Pick<DatabaseCopyResult, 'credentialCount' | 'hasAdditionalCredentials'>) => Promise<void> | void
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
  ctx: Pick<ResourceCtx, 'data' | 'makeClient' | 'platform'>,
  appIdentity: string,
  sourceIdentity: string,
  targetIdentity: string,
  options: DatabaseCopyOptions = {},
): Promise<DatabaseCopyResult> {
  const {beforeCopy, copyPoller, credentialToken, onCredentialsChecked, signal, waitPoller, ...waitOptions} = options
  signal?.throwIfAborted()

  const [source, target] = await Promise.all([
    resolveCopyEndpoint(ctx, appIdentity, sourceIdentity, signal),
    resolveCopyEndpoint(ctx, appIdentity, targetIdentity, signal),
  ])

  if (source.url === target.url) {
    throw new Error('Cannot copy database onto itself')
  }

  if (!source.database && !target.database) {
    throw new Error('Heroku PostgreSQL database must be source or target')
  }

  const progress = {source, target}
  await beforeCopy?.(progress)
  signal?.throwIfAborted()
  copyPoller?.onStart?.(progress)

  const herokuDatabase = target.database ?? source.database!
  const data = withSignal(ctx.data, signal)
  // The classic v11 pg:copy wire body omits from_type/to_type. Keep that
  // request shape while dispatching through the generated transfer route.
  const body: Omit<TransferCreateOpts, 'from_type' | 'to_type'> = {
    // eslint-disable-next-line camelcase
    from_name: source.name,
    // eslint-disable-next-line camelcase
    from_url: source.url,
    // eslint-disable-next-line camelcase
    to_name: target.name,
    // eslint-disable-next-line camelcase
    to_url: target.url,
  }
  // The generated schema marks the types required, but the classic v11 copy
  // API accepts and historically receives this body without either field.
  const created = await data.transfer.create(herokuDatabase.addon.id, body as TransferCreateOpts)
  copyPoller?.onStop?.(progress)

  let credentialCount: number | undefined
  if (source.database) {
    const credentialList = credentialToken === undefined
      ? await data.postgresDatabase.listCredentials(source.database.addon.id) as unknown as CredentialInfo[]
      : await listCredentialsWithToken(ctx, source.database.addon.name, credentialToken, signal)
    credentialCount = credentialList.length
  }

  const hasAdditionalCredentials = (credentialCount ?? 0) > 1
  await onCredentialsChecked?.({credentialCount, hasAdditionalCredentials})

  waitPoller?.onStart?.(created)
  // Preserve TransferFailedError unchanged: its transfer contains the full
  // verbose response, including logs and metadata callers need for CLI failure
  // text and follow-up hints.
  const transfer = await waitForTransfer(ctx, herokuDatabase.addon.app.name || appIdentity, created.uuid, {
    ...waitOptions,
    signal,
  })
  waitPoller?.onStop?.(created)

  return {
    credentialCount,
    hasAdditionalCredentials,
    source,
    target,
    transfer,
  }
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
): Promise<DatabaseCopyEndpoint> {
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
