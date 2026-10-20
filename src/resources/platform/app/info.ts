import type {
  AddOn, App, Collaborator, Dyno, PipelineCoupling,
} from '@heroku/types/3.sdk'

import type {ResourceCtx} from '../../../core/extend-resource.js'

import {withSignal} from '../../../core/with-signal.js'
import {isAbortError} from '../../../utils/is-abort-error.js'

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

// Collapse an expected soft error to a default, but never swallow an abort.
const softFail = <T>(fallback: T) => (error: unknown): T => {
  if (isAbortError(error)) throw error
  return fallback
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
 *
 * Cancellation is exempt from the soft-fail: an aborted sub-request
 * rethrows so the whole describe rejects instead of silently returning a
 * partial view when the caller cancelled.
 */
export async function describeApp(
  ctx: Pick<ResourceCtx, 'platform'>,
  appIdentity: string,
  options: DescribeAppOptions = {},
): Promise<AppInfo> {
  options.signal?.throwIfAborted()
  const platform = withSignal(ctx.platform, options.signal)

  const [addons, app, dynos, collaborators, pipelineCoupling] = await Promise.all([
    platform.addOn.listByApp(appIdentity),
    platform.app.info(appIdentity),
    platform.dyno.list(appIdentity).catch(softFail<Dyno[]>([])),
    platform.collaborator.list(appIdentity).catch(softFail<Collaborator[]>([])),
    (platform.pipelineCoupling.infoByApp(appIdentity) as Promise<null | PipelineCouplingDetail>)
      .catch(softFail<null | PipelineCouplingDetail>(null)),
  ])

  return {
    addons, app, collaborators, dynos, pipelineCoupling,
  }
}
