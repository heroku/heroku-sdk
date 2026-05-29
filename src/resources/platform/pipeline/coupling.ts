import type {PipelineCoupling, TeamApp} from '@heroku/types/3.sdk'

import createDebug from 'debug'

import type {ResourceCtx} from '../../../core/extend-resource.js'

import {extendResource} from '../../../core/extend-resource.js'

const debug = createDebug('heroku:sdk:resources:pipeline-coupling')

export type PipelineWarning = {
  limit: number
  pipelineId: string
  type: 'apps_truncated'
}

export type ListPipelineAppsOptions = {
  onWarning?: (warning: PipelineWarning) => void
  signal?: AbortSignal
}

export type AppWithPipelineCoupling = TeamApp & {
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
  const skipped = allCouplings.length - couplings.length
  if (skipped > 0) {
    debug('listPipelineApps pipeline=%s skipped=%d couplings without app.id', pipelineId, skipped)
  }

  if (couplings.length === 0) {
    return []
  }

  let couplingsToResolve = couplings
  if (couplings.length > APPS_FILTER_LIMIT) {
    if (!options.onWarning) {
      throw new Error(`Pipeline ${pipelineId} has more than ${APPS_FILTER_LIMIT} apps. `
        + 'Pass an onWarning handler to opt into a truncated result.')
    }

    debug('listPipelineApps pipeline=%s truncating couplings=%d limit=%d', pipelineId, couplings.length, APPS_FILTER_LIMIT)
    options.onWarning({limit: APPS_FILTER_LIMIT, pipelineId, type: 'apps_truncated'})
    couplingsToResolve = couplings.slice(0, APPS_FILTER_LIMIT)
  }

  options.signal?.throwIfAborted()
  const ids = couplingsToResolve.map(coupling => coupling.app!.id!)
  const apps = await ctx.platform
    .withHeaders({Range: `id ..; max=${APPS_FILTER_LIMIT};`})
    .filterApps.apps({in: {id: ids}})
  if (apps.length !== ids.length) {
    debug('listPipelineApps pipeline=%s requested=%d returned=%d', pipelineId, ids.length, apps.length)
  }

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
