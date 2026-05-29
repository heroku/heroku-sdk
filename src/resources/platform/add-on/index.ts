import type {AddOnCreateOpts} from '@heroku/types/3.sdk'

import type {
  AddOnOptions, CreateAndWaitOptions, ResolveAddonOptions, UpgradeAddOnOptions,
} from './types.js'

import {extendResource} from '../../../core/extend-resource.js'
import {createAndWait} from './create-and-wait.js'
import {describeAddon} from './describe.js'
import {listPlans} from './list-plans.js'
import {resolveAddon, resolveAddonByAttachment} from './resolve.js'
import {upgrade} from './upgrade.js'

export {createAndWait} from './create-and-wait.js'

export {describeAddon} from './describe.js'

export {
  AddonAmbiguousError,
  AddonConfirmationRequiredError,
  AddonNotFoundError,
  AddonProvisioningFailedError,
} from './errors.js'
export {listPlans} from './list-plans.js'
export {resolveAddon, resolveAddonByAttachment} from './resolve.js'
export type {
  AddOnOptions,
  CreateAndWaitOptions,
  DescribedAddOn,
  ResolveAddonOptions,
  ResolvedAddOn,
  UpgradeAddOnOptions,
} from './types.js'
export {upgrade} from './upgrade.js'

export const addOnExtensions = extendResource('platform', 'addOn', ctx => ({
  createAndWait: (appIdentity: string, body: AddOnCreateOpts, options?: CreateAndWaitOptions) =>
    createAndWait(ctx, appIdentity, body, options),
  describe: (addonIdentity: string, options?: ResolveAddonOptions) =>
    describeAddon(ctx, addonIdentity, options),
  listPlans: (serviceIdentity: string, options?: AddOnOptions) =>
    listPlans(ctx, serviceIdentity, options),
  resolve: (addonIdentity: string, options?: ResolveAddonOptions) =>
    resolveAddon(ctx, addonIdentity, options),
  resolveByAttachment: (appIdentity: string, attachmentName: string, options?: AddOnOptions) =>
    resolveAddonByAttachment(ctx, appIdentity, attachmentName, options),
  upgrade: (addonIdentity: string, plan: string, options?: UpgradeAddOnOptions) =>
    upgrade(ctx, addonIdentity, plan, options),
}))
