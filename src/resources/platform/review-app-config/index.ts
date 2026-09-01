import {extendResource} from '../../../core/extend-resource.js'
import {resolveRepoName, type ResolveRepoNameOptions} from './resolve-repo-name.js'

export {resolveRepoName, type ResolveRepoNameOptions} from './resolve-repo-name.js'

export const reviewAppConfigExtensions = extendResource('platform', 'reviewAppConfig', ctx => {
  const {repositoriesApi} = ctx
  if (!repositoriesApi) {
    throw new Error('reviewAppConfigExtensions requires ResourceCtx.repositoriesApi')
  }

  const resolveRepoNameCtx = {
    platform: ctx.platform,
    repositories: ctx.repositories,
    repositoriesApi,
  }

  return {
    resolveRepoName: (pipelineId: string, options?: ResolveRepoNameOptions) =>
      resolveRepoName(resolveRepoNameCtx, pipelineId, options),
  }
})
