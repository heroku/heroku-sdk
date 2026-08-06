import type {AddOn, AddOnCreateOpts} from '@heroku/types/3.sdk'

import type {ListPlansForAddonOptions} from './list-plans.js'
import type {
  AddOnOptions, CreateAndWaitOptions, DestroyAndWaitOptions, ResolveAddonOptions, UpgradeAddOnOptions, WaitForProvisioningOptions,
} from './types.js'

import {extendResource} from '../../../core/extend-resource.js'
import {createAndWait} from './create-and-wait.js'
import {describeAddon} from './describe.js'
import {destroyAndWait} from './destroy-and-wait.js'
import {listPlans, listPlansForAddon} from './list-plans.js'
import {formatPlanPriceLabel, priceForPlan} from './pricing.js'
import {resolveAddon, resolveAddonByAttachment, resolveAttachment} from './resolve.js'
import {upgrade} from './upgrade.js'
import {waitForProvisioning} from './wait-for-provisioning.js'

export {createAndWait} from './create-and-wait.js'
export {describeAddon} from './describe.js'

export {destroyAndWait} from './destroy-and-wait.js'

export {
  AddonAmbiguousError,
  AddonConfirmationRequiredError,
  AddonNotFoundError,
  AddonProvisioningFailedError,
} from './errors.js'
export {listPlans, listPlansForAddon, type ListPlansForAddonOptions} from './list-plans.js'
export {
  formatPlanPriceLabel,
  type FormatPlanPriceLabelOptions,
  type PlanPriceBreakdown,
  priceForPlan,
} from './pricing.js'
export {resolveAddon, resolveAddonByAttachment, resolveAttachment} from './resolve.js'
export type {
  AddOnOptions,
  CreateAndWaitOptions,
  DescribedAddOn,
  DestroyAndWaitOptions,
  ResolveAddonOptions,
  ResolvedAddOn,
  ResolvedAddOnAttachment,
  UpgradeAddOnOptions,
  WaitForProvisioningOptions,
} from './types.js'
export {upgrade} from './upgrade.js'
export {waitForProvisioning} from './wait-for-provisioning.js'

export const addOnExtensions = extendResource('platform', 'addOn', ctx => ({
  createAndWait: (appIdentity: string, body: AddOnCreateOpts, options?: CreateAndWaitOptions) =>
    createAndWait(ctx, appIdentity, body, options),
  describe: (addonIdentity: string, options?: ResolveAddonOptions) =>
    describeAddon(ctx, addonIdentity, options),
  destroyAndWait: (appIdentity: string, addonIdentity: string, options?: DestroyAndWaitOptions) =>
    destroyAndWait(ctx, appIdentity, addonIdentity, options),
  formatPlanPriceLabel,
  listPlans: (serviceIdentity: string, options?: AddOnOptions) =>
    listPlans(ctx, serviceIdentity, options),
  listPlansForAddon: (addonIdentity: string, options?: ListPlansForAddonOptions) =>
    listPlansForAddon(ctx, addonIdentity, options),
  priceForPlan,
  resolve: (addonIdentity: string, options?: ResolveAddonOptions) =>
    resolveAddon(ctx, addonIdentity, options),
  resolveByAttachment: (appIdentity: string, attachmentName: string, options?: AddOnOptions) =>
    resolveAddonByAttachment(ctx, appIdentity, attachmentName, options),
  resolveAttachment: (appIdentity: string, attachmentName: string, options?: AddOnOptions) =>
    resolveAttachment(ctx, appIdentity, attachmentName, options),
  upgrade: (addonIdentity: string, plan: string, options?: UpgradeAddOnOptions) =>
    upgrade(ctx, addonIdentity, plan, options),
  waitForProvisioning: (addon: AddOn, options?: WaitForProvisioningOptions) =>
    waitForProvisioning(ctx, addon, options),
}))
