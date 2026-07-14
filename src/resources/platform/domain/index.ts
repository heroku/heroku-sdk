import type {CreateAndWaitOptions, DomainOptions, WaitForReadyOptions} from './types.js'

import {extendResource} from '../../../core/extend-resource.js'
import {clearCustomDomains} from './clear-custom-domains.js'
import {createAndWait} from './create-and-wait.js'
import {waitForReady} from './wait-for-ready.js'

// Re-export implementations for direct use
export {clearCustomDomains} from './clear-custom-domains.js'
export {createAndWait} from './create-and-wait.js'
// Re-export types
export type {
  CreateAndWaitOptions,
  DomainOptions,
  WaitForReadyOptions,
} from './types.js'

export {waitForReady} from './wait-for-ready.js'

// Extension definition
export const domainExtensions = extendResource('platform', 'domain', ctx => ({
  add: (appIdentity: string, hostname: string, options?: CreateAndWaitOptions) =>
    createAndWait(ctx, appIdentity, hostname, options),

  clear: (appIdentity: string, options?: DomainOptions) =>
    clearCustomDomains(ctx, appIdentity, options),

  wait: (appIdentity: string, options?: WaitForReadyOptions) =>
    waitForReady(ctx, appIdentity, options),
}))
