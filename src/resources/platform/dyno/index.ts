import type {Formation} from '@heroku/types/3.sdk'

import type {StickyRouteOptions} from '../../../core/create-client.js'
import type {ResourceCtx} from '../../../core/extend-resource.js'

import {extendResource} from '../../../core/extend-resource.js'
import {
  enableExec,
  exchangeExecCredentials,
  type ExchangeExecCredentialsOptions,
  type ExecOptions,
  execPrereqs,
  execStatus,
  type ExecStatusOptions,
  restartForExec,
  type RestartForExecOptions,
} from './exec.js'
import {listExtended, type ListExtendedOptions} from './list-extended.js'
import {runDyno, type RunDynoOptions} from './run.js'
import {waitForInfo, type WaitForInfoOptions} from './wait-for-info.js'
import {waitForRelease, type WaitForReleaseOptions} from './wait-for-release.js'

export {
  DynoCrashedError,
  enableExec,
  exchangeExecCredentials,
  type ExchangeExecCredentialsOptions,
  type ExecCredentials,
  type ExecOptions,
  type ExecPrereqs,
  execPrereqs,
  type ExecReservation,
  execStatus,
  type ExecStatusOptions,
  restartForExec,
  type RestartForExecOptions,
} from './exec.js'
export {
  type DynoExtended, type DynoExtendedFields, listExtended, type ListExtendedOptions,
} from './list-extended.js'
export {runDyno, type RunDynoOptions} from './run.js'
export {
  DynoNotReadyError, type DynoState, waitForInfo, type WaitForInfoOptions,
} from './wait-for-info.js'
export {
  waitForRelease, type WaitForReleaseOptions, type WaitForReleaseProgress, type WaitForReleaseResult,
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

  restart: (appIdentity: string, target?: RestartDynosTarget, options?: DynoOptions) => (
    restartDynos(ctx, appIdentity, target, options)
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
