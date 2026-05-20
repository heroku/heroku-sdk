import type {App, PipelineCoupling} from '@heroku/types/3.sdk'

import {HerokuApiClient, type HerokuApiClientOptions} from '@heroku/heroku-fetch'

import type {ResourceCtx} from '../../core/extend-resource.js'

import {extendResource} from '../../core/extend-resource.js'

export type PipelineWarning = {
  limit: number
  pipelineId: string
  type: 'apps_truncated'
}

export type ListPipelineAppsOptions = {
  clientOptions?: HerokuApiClientOptions
  onWarning?: (warning: PipelineWarning) => void
  signal?: AbortSignal
}

export type AppWithPipelineCoupling = App & {
  pipelineCoupling: PipelineCoupling
}

const APPS_FILTER_LIMIT = 1000

/**
 * List the apps coupled to a pipeline, each decorated with its
 * `PipelineCoupling`.
 *
 * Couplings missing an app id are dropped before issuing the bulk
 * filter call. If the pipeline has more than 1000 couplings, an
 * `onWarning` handler must be supplied to opt into a truncated
 * result; otherwise this throws.
 */
export async function listPipelineApps(
  ctx: Pick<ResourceCtx, 'platform'>,
  pipelineId: string,
  options: ListPipelineAppsOptions = {},
): Promise<AppWithPipelineCoupling[]> {
  options.signal?.throwIfAborted()
  const allCouplings = await ctx.platform.pipelineCoupling.listByPipeline(pipelineId)
  // Drop malformed couplings (no app id) before issuing the bulk filter call.
  const couplings = allCouplings.filter(coupling => coupling.app?.id)
  if (couplings.length === 0) {
    return []
  }

  let couplingsToResolve = couplings
  if (couplings.length > APPS_FILTER_LIMIT) {
    if (!options.onWarning) {
      throw new Error(`Pipeline ${pipelineId} has more than ${APPS_FILTER_LIMIT} apps. `
        + 'Pass an onWarning handler to opt into a truncated result.')
    }

    options.onWarning({limit: APPS_FILTER_LIMIT, pipelineId, type: 'apps_truncated'})
    couplingsToResolve = couplings.slice(0, APPS_FILTER_LIMIT)
  }

  options.signal?.throwIfAborted()
  // /filters/apps is a Platform bulk endpoint that's not in the SDK route
  // registry, so call it through a raw HerokuApiClient. It accepts the
  // standard platform Accept header but uses a different `.filters` suffix.
  const apiClient = new HerokuApiClient({
    ...options.clientOptions,
    service: 'platform',
  })
  const ids = couplingsToResolve.map(coupling => coupling.app!.id!)
  const response = await apiClient.post('/filters/apps', {in: {id: ids}}, {
    headers: {
      Accept: 'application/vnd.heroku+json; version=3.filters',
      Range: `id ..; max=${APPS_FILTER_LIMIT};`,
    },
  })
  const apps = (await response.json()) as App[]

  const couplingByAppId = new Map<string, PipelineCoupling>()
  for (const coupling of couplingsToResolve) {
    couplingByAppId.set(coupling.app!.id!, coupling)
  }

  return apps.map(app => ({
    ...app,
    pipelineCoupling: couplingByAppId.get(app.id!)!,
  }))
}

export const pipelineCouplingExtensions = extendResource('platform', 'pipelineCoupling', ctx => ({
  listApps: (pipelineId: string, options?: ListPipelineAppsOptions) =>
    listPipelineApps(ctx, pipelineId, options),
}))
