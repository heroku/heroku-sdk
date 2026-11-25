import type {Collaborator, TeamAppCollaboratorUpdateOpts} from '@heroku/types/3.sdk'

import type {AddCollaboratorOptions} from './add.js'
import type {AdminCollaborator} from './list.js'
import type {RemoveSelfOptions} from './remove-self.js'

import {extendResource} from '../../../core/extend-resource.js'
import {add} from './add.js'
import {list} from './list.js'
import {removeSelf} from './remove-self.js'
import {remove} from './remove.js'
import {update} from './update.js'

export {add, type AddCollaboratorOptions} from './add.js'
export {type AdminCollaborator, list} from './list.js'
export {type BeforeRemove, removeSelf, type RemoveSelfOptions} from './remove-self.js'
export {remove} from './remove.js'
export {NotATeamAppError, update} from './update.js'

export type AppCollaboratorOptions = {
  signal?: AbortSignal
}

/** Always include `view`, then sort and de-duplicate. */
export function normalizePermissions(permissions: string[]): string[] {
  return [...new Set(['view', ...permissions])].sort()
}

export const appCollaboratorExtensions = extendResource('platform', 'appCollaborator', ctx => ({
  add: (appIdentity: string, email: string, options?: AddCollaboratorOptions) =>
    add(ctx, appIdentity, email, options),
  list: (appIdentity: string, options?: AppCollaboratorOptions): Promise<Array<AdminCollaborator | Collaborator>> =>
    list(ctx, appIdentity, options),
  remove: (appIdentity: string, email: string, options?: AppCollaboratorOptions) =>
    remove(ctx, appIdentity, email, options),
  removeSelf: (appIdentity: string, options?: RemoveSelfOptions) => removeSelf(ctx, appIdentity, options),
  update: (appIdentity: string, email: string, body: TeamAppCollaboratorUpdateOpts, options?: AppCollaboratorOptions) =>
    update(ctx, appIdentity, email, body, options),
}))
