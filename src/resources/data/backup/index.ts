import type {CaptureAndWaitOptions} from './capture-and-wait.js'

import {extendResource} from '../../../core/extend-resource.js'
import {captureAndWait} from './capture-and-wait.js'

export {captureAndWait, type CaptureAndWaitOptions} from './capture-and-wait.js'

export const backupExtensions = extendResource('data', 'backup', ctx => ({
  captureAndWait: (appIdentity: string, addonIdentity?: string, options?: CaptureAndWaitOptions) =>
    captureAndWait(ctx, appIdentity, addonIdentity, options),
}))
