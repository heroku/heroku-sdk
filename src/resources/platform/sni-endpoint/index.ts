import type {CreateAndAssociateOptions} from './create-and-associate.js'

import {extendResource} from '../../../core/extend-resource.js'
import {createAndAssociate} from './create-and-associate.js'

export {createAndAssociate, type CreateAndAssociateOptions} from './create-and-associate.js'

export const sniEndpointExtensions = extendResource('platform', 'sniEndpoint', ctx => ({
  createAndAssociate: (
    appIdentity: string,
    certificateChain: string,
    privateKey: string,
    options: CreateAndAssociateOptions,
  ) => createAndAssociate(ctx, appIdentity, certificateChain, privateKey, options),
}))
