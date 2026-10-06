import type {ResolveAddonAttachmentOptions} from './resolve.js'

import {extendResource} from '../../../core/extend-resource.js'
import {resolveAddonAttachment} from './resolve.js'

export {AddonAttachmentAmbiguousError, AddonAttachmentNotFoundError, resolveAddonAttachment} from './resolve.js'
export type {ResolveAddonAttachmentOptions, ResolvedAddOnAttachment} from './resolve.js'

export const addOnAttachmentExtensions = extendResource('platform', 'addOnAttachment', ctx => ({
  resolve: (appIdentity: string | undefined, attachmentName: string, options?: ResolveAddonAttachmentOptions) =>
    resolveAddonAttachment(ctx, appIdentity, attachmentName, options),
}))
