import type {Formation} from '@heroku/types/3.sdk'

import type {StickyRouteOptions} from '../../../core/create-client.js'
import type {ResourceCtx} from '../../../core/extend-resource.js'

import {extendResource} from '../../../core/extend-resource.js'
import {
  enableExec,
  type ExchangeExecCredentialsOptions,
  exchangeExecCredentials,
  type ExecOptions,
  execPrereqs,
  execStatus,
  type ExecStatusOptions,
  type RestartForExecOptions,
  restartForExec,
} from './exec.js'
import {type ListExtendedOptions, listExtended} from './list-extended.js'
import {runDyno, type RunDynoOptions} from './run.js'
import {waitForInfo, type WaitForInfoOptions} from './wait-for-info.js'
import {type WaitForReleaseOptions, waitForRelease} from './wait-for-release.js'

export {
  DynoCrashedError,
  enableExec,
  type ExchangeExecCredentialsOptions,
  exchangeExecCredentials,
  type ExecCredentials,
  type ExecOptions,
  type ExecPrereqs,
  type ExecReservation,
  execStatus,
  type ExecStatusOptions,
  execPrereqs,
  type RestartForExecOptions,
  restartForExec,
} from './exec.js'
export {
  type DynoExtended, type DynoExtendedFields, type ListExtendedOptions, listExtended,
} from './list-extended.js'
export {runDyno, type RunDynoOptions} from './run.js'
export {
  DynoNotReadyError, type DynoState, waitForInfo, type WaitForInfoOptions,
} from './wait-for-info.js'
export {
  type WaitForReleaseOptions, type WaitForReleaseProgress, waitForRelease, type WaitForReleaseResult,
} from './wait-for-release.js'

export type DynoOptions = {
  signal?: AbortSignal
}

export type ScaleDynosUpdate = {
  dyno_size?: {id?: string; name?: string}
  quantity?: number | string
  size?: string
  type: string
}

export type RestartDynosTarget
  = | {dyno: string}
  | {type: string}

type FormationClient = {
  batchUpdate(appIdentity: string, body: {updates: ScaleDynosUpdate[]}): Promise<Formation[]>
  update(appIdentity: string, type: string, body: Omit<ScaleDynosUpdate, 'type'>): Promise<Formation>
}

type ScalePlatform = {
  formation: FormationClient
  withOptions(opts: StickyRouteOptions): ScalePlatform
}

export function scaleDynos(
  ctx: {platform: ScalePlatform},
  appIdentity: string,
  updates: ScaleDynosUpdate,
  options?: DynoOptions,
): Promise<Formation>
export function scaleDynos(
  ctx: {platform: ScalePlatform},
  appIdentity: string,
  updates: ScaleDynosUpdate[],
  options?: DynoOptions,
): Promise<Formation[]>
export async function scaleDynos(
  ctx: {platform: ScalePlatform},
  appIdentity: string,
  updates: ScaleDynosUpdate | ScaleDynosUpdate[],
  options: DynoOptions = {},
): Promise<Formation | Formation[]> {
  options.signal?.throwIfAborted()
  const platform = options.signal ? ctx.platform.withOptions({signal: options.signal}) : ctx.platform

  if (Array.isArray(updates)) {
    return platform.formation.batchUpdate(appIdentity, {updates})
  }

  const {type, ...body} = updates
  return platform.formation.update(appIdentity, type, body)
}

export async function restartDynos(
  ctx: Pick<ResourceCtx, 'platform'>,
  appIdentity: string,
  target?: RestartDynosTarget,
  options: DynoOptions = {},
): Promise<void> {
  options.signal?.throwIfAborted()

  if (!target) {
    await ctx.platform.dyno.restartAll(appIdentity)
    return
  }

  if ('dyno' in target) {
    await ctx.platform.dyno.restart(appIdentity, target.dyno)
    return
  }

  await ctx.platform.dyno.restartFormation(appIdentity, target.type)
}

export const dynoExtensions = extendResource('platform', 'dyno', ctx => ({
  restart: (appIdentity: string, target?: RestartDynosTarget, options?: DynoOptions) => (
    restartDynos(ctx, appIdentity, target, options)
  ),

  enableExec: (appIdentity: string, options?: ExecOptions) => (
    enableExec(ctx, appIdentity, options)
  ),

  exchangeExecCredentials: (appIdentity: string, options: ExchangeExecCredentialsOptions) => (
    exchangeExecCredentials(appIdentity, options)
  ),

  execPrereqs: (appIdentity: string, options?: ExecOptions) => (
    execPrereqs(ctx, appIdentity, options)
  ),

  execStatus: (appIdentity: string, options: ExecStatusOptions) => (
    execStatus(appIdentity, options)
  ),

  listExtended: (appIdentity: string, options?: ListExtendedOptions) => (
    listExtended(appIdentity, options)
  ),

  restartForExec: (appIdentity: string, dynoIdentity: string, options?: RestartForExecOptions) => (
    restartForExec(ctx, appIdentity, dynoIdentity, options)
  ),

  run: (appIdentity: string, command: string, options?: RunDynoOptions) => (
    runDyno(ctx, appIdentity, command, options)
  ),

  scale: ((appIdentity: string, updates: never, options?: DynoOptions) =>
    scaleDynos(ctx, appIdentity, updates, options)) as {
    (appIdentity: string, updates: ScaleDynosUpdate, options?: DynoOptions): Promise<Formation>
    (appIdentity: string, updates: ScaleDynosUpdate[], options?: DynoOptions): Promise<Formation[]>
  },

  waitForInfo: (appIdentity: string, dynoIdentity: string, options?: WaitForInfoOptions) => (
    waitForInfo(ctx, appIdentity, dynoIdentity, options)
  ),

  waitForRelease: (appIdentity: string, options?: WaitForReleaseOptions) => (
    waitForRelease(ctx, appIdentity, options)
  ),
}))
