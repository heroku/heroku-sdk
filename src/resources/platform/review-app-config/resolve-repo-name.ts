import type {ResourceCtx} from '../../../core/extend-resource.js'

import {debug} from './debug.js'

type ResolveRepoNameCtx = Pick<ResourceCtx, 'platform' | 'repositories'> & {
  repositoriesApi: NonNullable<ResourceCtx['repositoriesApi']>
}

export type ResolveRepoNameOptions = {
  signal?: AbortSignal
}

/**
 * Resolves the GitHub repository name for a canonical pipeline ID.
 * Resolve user-supplied pipeline names before calling this helper.
 */
export async function resolveRepoName(
  ctx: ResolveRepoNameCtx,
  pipelineId: string,
  options: ResolveRepoNameOptions = {},
): Promise<string> {
  const {signal} = options
  signal?.throwIfAborted()

  const platform = signal ? ctx.platform.withOptions({signal}) : ctx.platform
  let useRepositoriesApi: boolean | undefined
  try {
    const feature = await platform.accountFeature.info('dashboard-repositories-api')
    signal?.throwIfAborted()
    useRepositoriesApi = feature.enabled
  } catch (error) {
    signal?.throwIfAborted()
    debug('feature lookup failed error=%s; falling back', describeError(error))
  }

  if (useRepositoriesApi) {
    try {
      const repositoriesApi = signal ? ctx.repositoriesApi.withOptions({signal}) : ctx.repositoriesApi
      const repository = await repositoriesApi.githubRepository.info(pipelineId)
      signal?.throwIfAborted()
      const repositoryName = repository.full_name?.trim()
      if (repositoryName) {
        return repositoryName
      }

      debug('repositories API returned no full name; falling back')
    } catch (error) {
      signal?.throwIfAborted()
      debug('repositories API lookup failed error=%s; falling back', describeError(error))
    }
  } else if (useRepositoriesApi === false) {
    signal?.throwIfAborted()
    debug('repositories API disabled; falling back')
  }

  const repositories = signal ? ctx.repositories.withOptions({signal}) : ctx.repositories
  const pipelineRepository = await repositories.pipelineRepository.info(pipelineId)
  signal?.throwIfAborted()
  const repositoryName = pipelineRepository.repository.name.trim()
  if (!repositoryName) {
    throw new Error('Repositories service returned no repository name')
  }

  return repositoryName
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.name : typeof error
}
