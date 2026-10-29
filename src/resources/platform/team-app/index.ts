import type {JoinSelfOptions} from './join-self.js'

import {extendResource} from '../../../core/extend-resource.js'
import {joinSelf} from './join-self.js'

export {joinSelf, type JoinSelfOptions} from './join-self.js'

export const teamAppExtensions = extendResource('platform', 'teamApp', ctx => ({
  joinSelf: (appIdentity: string, options?: JoinSelfOptions) => joinSelf(ctx, appIdentity, options),
}))
