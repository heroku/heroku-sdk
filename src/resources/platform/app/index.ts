import type {App} from '@heroku/types/3.sdk'

import type {ResourceCtx} from '../../../core/extend-resource.js'
import type {CreateAndSetupInput, CreateAndSetupOptions} from './create-and-setup.js'
import type {DescribeAppOptions} from './info.js'
import type {TransferOptions} from './transfer.js'
import type {WaitForACMCertificatesOptions} from './wait-for-acm-certificates.js'

import {extendResource} from '../../../core/extend-resource.js'
import {createAndSetup} from './create-and-setup.js'
import {describeApp} from './info.js'
import {transferApp} from './transfer.js'
import {waitForACMCertificates} from './wait-for-acm-certificates.js'

export {
  createAndSetup, type CreateAndSetupInput, type CreateAndSetupOptions, type SetupStep,
} from './create-and-setup.js'
export {
  type AppInfo, describeApp, type DescribeAppOptions, type PipelineCouplingDetail,
} from './info.js'
export {transferApp, type TransferOptions} from './transfer.js'
export {waitForACMCertificates, type WaitForACMCertificatesOptions} from './wait-for-acm-certificates.js'

export type AppMaintenanceOptions = {
  signal?: AbortSignal
}

export type GenerationKind = 'cedar' | 'fir'

export type GetGenerationOptions = {
  signal?: AbortSignal
}

export type IsShieldedOptions = {
  signal?: AbortSignal
}

export type GetProcessTierOptions = {
  signal?: AbortSignal
}

export type ProcessTier = 'basic' | 'eco' | 'performance' | 'private' | 'shield' | 'standard' | (string & {})

export async function enableMaintenance(
  ctx: Pick<ResourceCtx, 'platform'>,
  appIdentity: string,
  options: AppMaintenanceOptions = {},
): Promise<App> {
  options.signal?.throwIfAborted()
  return ctx.platform.app.update(appIdentity, {maintenance: true})
}

export async function disableMaintenance(
  ctx: Pick<ResourceCtx, 'platform'>,
  appIdentity: string,
  options: AppMaintenanceOptions = {},
): Promise<App> {
  options.signal?.throwIfAborted()
  return ctx.platform.app.update(appIdentity, {maintenance: false})
}

/**
 * Look up the platform generation (`cedar` or `fir`) of an app.
 *
 * Issues `app.info` with the `version=3.sdk` Accept variant so the
 * response includes the `generation` field, then normalizes the
 * platform's strings to the `'cedar' | 'fir'` union. Returns
 * `undefined` if the platform reports an unrecognized value (e.g. a
 * future generation name we haven't taught the SDK about).
 */
export async function getGeneration(
  ctx: Pick<ResourceCtx, 'platform'>,
  appIdentity: string,
  options: GetGenerationOptions = {},
): Promise<GenerationKind | undefined> {
  options.signal?.throwIfAborted()
  const platform = ctx.platform.withHeaders({
    Accept: 'application/vnd.heroku+json; version=3.sdk',
  })
  const app = await platform.app.info(appIdentity)
  return parseGeneration(app.generation as string | undefined)
}

function parseGeneration(value: string | undefined): GenerationKind | undefined {
  if (value === 'cedar' || value === 'fir') return value
  return undefined
}

type AppInfoResult = App & {
  process_tier?: string
  // The SDK's `App.space` is `{...} | null`, not `{...} | undefined`,
  // so the override has to allow null (or omit `space` entirely and
  // inherit from `App`). Keeping the override here documents that
  // we use `space.shield` and lets future fields land in one place.
  space?: null | {shield?: boolean}
}

type AppInfoPlatform = {
  app: {info(appIdentity: string): Promise<AppInfoResult>}
  withOptions(opts: {signal: AbortSignal}): AppInfoPlatform
}

export async function isShielded(
  ctx: {platform: AppInfoPlatform},
  appIdentity: string,
  options: IsShieldedOptions = {},
): Promise<boolean> {
  options.signal?.throwIfAborted()
  const platform = options.signal ? ctx.platform.withOptions({signal: options.signal}) : ctx.platform
  const app = await platform.app.info(appIdentity)
  return Boolean(app.space?.shield)
}

export async function getProcessTier(
  ctx: {platform: AppInfoPlatform},
  appIdentity: string,
  options: GetProcessTierOptions = {},
): Promise<ProcessTier | undefined> {
  options.signal?.throwIfAborted()
  const platform = options.signal ? ctx.platform.withOptions({signal: options.signal}) : ctx.platform
  const app = await platform.app.info(appIdentity)
  return app.process_tier as ProcessTier | undefined
}

export const appExtensions = extendResource('platform', 'app', ctx => ({
  createAndSetup: (input: CreateAndSetupInput, options?: CreateAndSetupOptions) =>
    createAndSetup(ctx, input, options),
  describe: (appIdentity: string, options?: DescribeAppOptions) =>
    describeApp(ctx, appIdentity, options),
  disableMaintenance: (appIdentity: string, options?: AppMaintenanceOptions) =>
    disableMaintenance(ctx, appIdentity, options),
  enableMaintenance: (appIdentity: string, options?: AppMaintenanceOptions) =>
    enableMaintenance(ctx, appIdentity, options),
  getGeneration: (appIdentity: string, options?: GetGenerationOptions) =>
    getGeneration(ctx, appIdentity, options),
  getProcessTier: (appIdentity: string, options?: GetProcessTierOptions) =>
    getProcessTier(ctx, appIdentity, options),
  isShielded: (appIdentity: string, options?: IsShieldedOptions) =>
    isShielded(ctx, appIdentity, options),
  transfer: (appIdentity: string, recipient: string, options?: TransferOptions) =>
    transferApp(ctx, appIdentity, recipient, options),
  waitForACMCertificates: (appIdentity: string, options?: WaitForACMCertificatesOptions) =>
    waitForACMCertificates(ctx, appIdentity, options),
}))
