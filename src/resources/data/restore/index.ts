import type {RestoreAndWaitOptions} from './restore-and-wait.js'

import {extendResource} from '../../../core/extend-resource.js'
import {restoreAndWait} from './restore-and-wait.js'

export {restoreAndWait, type RestoreAndWaitOptions} from './restore-and-wait.js'

export const restoreExtensions = extendResource('data', 'restore', ctx => ({
  restoreAndWait: (
    appIdentity: string,
    addonIdentity: string | undefined,
    backupUrl: string,
    options?: RestoreAndWaitOptions,
  ) => restoreAndWait(ctx, appIdentity, addonIdentity, backupUrl, options),
}))
