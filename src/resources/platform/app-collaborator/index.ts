import type {RemoveSelfOptions} from './remove-self.js'

import {extendResource} from '../../../core/extend-resource.js'
import {removeSelf} from './remove-self.js'

export {type BeforeRemove, removeSelf, type RemoveSelfOptions} from './remove-self.js'

export const appCollaboratorExtensions = extendResource('platform', 'appCollaborator', ctx => ({
  removeSelf: (appIdentity: string, options?: RemoveSelfOptions) => removeSelf(ctx, appIdentity, options),
}))
