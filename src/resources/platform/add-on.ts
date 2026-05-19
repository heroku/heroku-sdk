import type {AddOn} from '@heroku/types/3.sdk'

import type {ResourceCtx} from '../../core/extend-resource.js'

import {extendResource} from '../../core/extend-resource.js'

export type AddOnUpgradeOptions = {
  signal?: AbortSignal
}

export async function upgrade(
  ctx: Pick<ResourceCtx, 'platform'>,
  appIdentity: string,
  addOnIdentity: string,
  plan: string,
  options: AddOnUpgradeOptions = {},
): Promise<AddOn> {
  options.signal?.throwIfAborted()
  return ctx.platform.addOn.update(appIdentity, addOnIdentity, {plan})
}

export const addOnExtensions = extendResource('platform', 'addOn', ctx => ({
  upgrade: (appIdentity: string, addOnIdentity: string, plan: string, options?: AddOnUpgradeOptions) =>
    upgrade(ctx, appIdentity, addOnIdentity, plan, options),
}))
