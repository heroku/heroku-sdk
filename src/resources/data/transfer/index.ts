import type {CaptureAndWaitOptions} from './capture-and-wait.js'
import type {RestoreAndWaitOptions} from './restore-and-wait.js'

import {extendResource} from '../../../core/extend-resource.js'
import {captureAndWait} from './capture-and-wait.js'
import {restoreAndWait} from './restore-and-wait.js'

export {captureAndWait, type CaptureAndWaitOptions} from './capture-and-wait.js'
export {restoreAndWait, type RestoreAndWaitOptions} from './restore-and-wait.js'
export {transferExtensions, TransferFailedError, TransferTimeoutError} from './wait-for-transfer.js'

export const restoreExtensions = extendResource('data', 'restore', ctx => ({
  restoreAndWait: (
    appIdentity: string,
    addonIdentity: string | undefined,
    backupUrl: string,
    options?: RestoreAndWaitOptions,
  ) => restoreAndWait(ctx, appIdentity, addonIdentity, backupUrl, options),
}))

export const backupExtensions = extendResource('data', 'backup', ctx => ({
  captureAndWait: (
    appIdentity: string,
    addonIdentity?: string,
    options?: CaptureAndWaitOptions,
  ) => captureAndWait(ctx, appIdentity, addonIdentity, options),
}))
