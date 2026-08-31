import type {ResourceCtx} from '../../../core/extend-resource.js'

import {extendResource} from '../../../core/extend-resource.js'
import {resolveRepoName, type ResolveRepoNameOptions} from './resolve-repo-name.js'

export {resolveRepoName, type ResolveRepoNameOptions} from './resolve-repo-name.js'

export const reviewAppConfigExtensions = extendResource('platform', 'reviewAppConfig', ctx => ({
  resolveRepoName: (pipelineIdentity: string, options?: ResolveRepoNameOptions) =>
    resolveRepoName(ctx as ResourceCtx & {repositoriesApi: NonNullable<ResourceCtx['repositoriesApi']>}, pipelineIdentity, options),
}))
