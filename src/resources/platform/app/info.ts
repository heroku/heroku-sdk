import type {
  AddOn, App, Collaborator, Dyno, PipelineCoupling,
} from '@heroku/types/3.sdk'

import type {ResourceCtx} from '../../../core/extend-resource.js'

export type DescribeAppOptions = {
  signal?: AbortSignal
}

export type PipelineCouplingDetail = PipelineCoupling & {
  pipeline: {id?: string; name: string}
  stage: 'development' | 'production' | 'review' | 'staging' | 'test'
}

export type AppInfo = {
  addons: AddOn[]
  app: App
  collaborators: Collaborator[]
  dynos: Dyno[]
  pipelineCoupling: null | PipelineCouplingDetail
}

/**
 * Composite "describe this app" view: parallel-fetches add-ons, the app
 * itself, dynos, collaborators, and the pipeline coupling.
 *
 * Hard-fails on add-ons or app (the response is meaningless without
 * either). Soft-fails on dynos, collaborators, and pipeline coupling —
 * any error collapses to an empty default. The broad .catch is
 * intentional v1 fidelity with the Heroku CLI's apps:info; a future
 * tightening to specific status codes is non-breaking.
 */
export async function describeApp(
  ctx: Pick<ResourceCtx, 'platform'>,
  appIdentity: string,
  options: DescribeAppOptions = {},
): Promise<AppInfo> {
  options.signal?.throwIfAborted()
  const platform = options.signal
    ? ctx.platform.withOptions({signal: options.signal})
    : ctx.platform

  const [addons, app, dynos, collaborators, pipelineCoupling] = await Promise.all([
    platform.addOn.listByApp(appIdentity),
    platform.app.info(appIdentity),
    platform.dyno.list(appIdentity).catch((): Dyno[] => []),
    platform.collaborator.list(appIdentity).catch((): Collaborator[] => []),
    platform.pipelineCoupling.infoByApp(appIdentity)
      .catch((): null => null) as Promise<null | PipelineCouplingDetail>,
  ])

  return {
    addons, app, collaborators, dynos, pipelineCoupling,
  }
}
