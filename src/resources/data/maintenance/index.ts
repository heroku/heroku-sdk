import type {MaintenanceScheduleOpts, MaintenanceUpdateWindowOpts} from '@heroku/types/data'

import type {ResolvedAddOn} from '../../platform/add-on/types.js'
import type {GetMaintenanceHistoryOptions} from './history.js'
import type {GetMaintenanceInfoOptions} from './info.js'
import type {RunMaintenanceOptions} from './run.js'
import type {ScheduleMaintenanceOptions} from './schedule.js'
import type {WaitForMaintenanceCompletionOptions} from './wait-for-completion.js'
import type {GetMaintenanceWindowOptions, UpdateMaintenanceWindowOptions} from './window.js'

import {extendResource} from '../../../core/extend-resource.js'
import {history} from './history.js'
import {info} from './info.js'
import {run} from './run.js'
import {schedule} from './schedule.js'
import {waitForCompletion} from './wait-for-completion.js'
import {getWindow, updateWindow} from './window.js'

export type MaintenanceCallPreview = {addon: ResolvedAddOn}

export type MaintenanceOptions = {
  appIdentity?: string
  signal?: AbortSignal
}

export {type GetMaintenanceHistoryOptions, type GetMaintenanceHistoryResult, history} from './history.js'
export {type GetMaintenanceInfoOptions, type GetMaintenanceInfoResult, info} from './info.js'
export {run, type RunMaintenanceOptions, type RunMaintenanceResult} from './run.js'
export {schedule, type ScheduleMaintenanceOptions, type ScheduleMaintenanceResult} from './schedule.js'
export {waitForCompletion, type WaitForMaintenanceCompletionOptions} from './wait-for-completion.js'
export {
  type GetMaintenanceWindowOptions, type GetMaintenanceWindowResult, getWindow,
  type UpdateMaintenanceWindowOptions, type UpdateMaintenanceWindowResult, updateWindow,
} from './window.js'

export const maintenanceExtensions = extendResource('data', 'maintenance', ctx => ({
  history: (
    addonIdentity: string,
    query?: {limit?: number},
    options?: GetMaintenanceHistoryOptions,
  ) => history(ctx, addonIdentity, query, options),
  info: (
    addonIdentity: string,
    options?: GetMaintenanceInfoOptions,
  ) => info(ctx, addonIdentity, options),
  run: (
    addonIdentity: string,
    options?: RunMaintenanceOptions,
  ) => run(ctx, addonIdentity, options),
  schedule: (
    addonIdentity: string,
    body: MaintenanceScheduleOpts,
    options?: ScheduleMaintenanceOptions,
  ) => schedule(ctx, addonIdentity, body, options),
  updateWindow: (
    addonIdentity: string,
    body: MaintenanceUpdateWindowOpts,
    options?: UpdateMaintenanceWindowOptions,
  ) => updateWindow(ctx, addonIdentity, body, options),
  wait: (
    addonIdentity: string,
    options?: WaitForMaintenanceCompletionOptions,
  ) => waitForCompletion(ctx, addonIdentity, options),
  window: (
    addonIdentity: string,
    options?: GetMaintenanceWindowOptions,
  ) => getWindow(ctx, addonIdentity, options),
}))
