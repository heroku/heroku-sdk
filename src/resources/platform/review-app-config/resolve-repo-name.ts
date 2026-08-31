import type {ResourceCtx} from '../../../core/extend-resource.js'

type ResolveRepoNameCtx = Pick<ResourceCtx, 'platform' | 'repositories'> & {
  repositoriesApi: NonNullable<ResourceCtx['repositoriesApi']>
}

export type ResolveRepoNameOptions = {
  signal?: AbortSignal
}

export async function resolveRepoName(
  ctx: ResolveRepoNameCtx,
  pipelineIdentity: string,
  options: ResolveRepoNameOptions = {},
): Promise<string> {
  const {signal} = options
  signal?.throwIfAborted()

  const platform = signal ? ctx.platform.withOptions({signal}) : ctx.platform
  let useRepositoriesApi = false
  try {
    const feature = await platform.accountFeature.info('dashboard-repositories-api')
    signal?.throwIfAborted()
    useRepositoriesApi = feature.enabled
  } catch {
    signal?.throwIfAborted()
  }

  if (useRepositoriesApi) {
    try {
      const repositoriesApi = signal ? ctx.repositoriesApi.withOptions({signal}) : ctx.repositoriesApi
      const repository = await repositoriesApi.githubRepository.info(pipelineIdentity)
      signal?.throwIfAborted()
      if (typeof repository.full_name === 'string' && repository.full_name.trim()) {
        return repository.full_name
      }

      signal?.throwIfAborted()
    } catch {
      signal?.throwIfAborted()
    }
  } else {
    signal?.throwIfAborted()
  }

  const repositories = signal ? ctx.repositories.withOptions({signal}) : ctx.repositories
  const pipelineRepository = await repositories.pipelineRepository.info(pipelineIdentity)
  signal?.throwIfAborted()
  return pipelineRepository.repository.name
}
