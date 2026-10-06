import type {AddonAttachmentOptions} from './resolve.js'

import {extendResource} from '../../../core/extend-resource.js'
import {resolveAddonAttachment} from './resolve.js'

export {AddonAttachmentAmbiguousError, AddonAttachmentNotFoundError, resolveAddonAttachment} from './resolve.js'
export type {AddonAttachmentOptions, ResolvedAddOnAttachment} from './resolve.js'

export const addOnAttachmentExtensions = extendResource('platform', 'addOnAttachment', ctx => ({
  resolve: (appIdentity: string | undefined, attachmentName: string, options?: AddonAttachmentOptions) =>
    resolveAddonAttachment(ctx, appIdentity, attachmentName, options),
}))
