import type {PipelineCoupling} from '@heroku/types/3.sdk'

import type {ResourceCtx} from '../../../core/extend-resource.js'

import {combineSignals} from '../../../core/with-signal.js'

const PLATFORM_API_ACCEPT = 'application/vnd.heroku+json; version=3'

export type RemoveByAppOptions = {
  signal?: AbortSignal
}

export class CouplingNotFoundError extends Error {
  public readonly id = 'not_found'
  public readonly resource = 'pipeline_coupling'
  public readonly statusCode = 404

  constructor(message: string, cause: unknown) {
    super(message, {cause})
    this.name = 'CouplingNotFoundError'
  }

  public get body() {
    return {id: this.id, message: this.message, resource: this.resource}
  }
}

export async function removeByApp(
  ctx: Pick<ResourceCtx, 'operationSignal' | 'platform'>,
  appIdentity: string,
  options: RemoveByAppOptions = {},
): Promise<PipelineCoupling | undefined> {
  const signal = combineSignals(ctx.operationSignal, options.signal)
  signal?.throwIfAborted()
  const platform = ctx.platform.withOptions({headers: {Accept: PLATFORM_API_ACCEPT}, signal})
  let coupling: PipelineCoupling
  try {
    coupling = await platform.pipelineCoupling.infoByApp(appIdentity)
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'statusCode' in error
      && error.statusCode === 404 && 'resource' in error && error.resource === 'pipeline_coupling') {
      throw new CouplingNotFoundError(
        'message' in error && typeof error.message === 'string' ? error.message : `Couldn't find a pipeline coupling for '${appIdentity}'.`,
        error,
      )
    }

    throw error
  }

  if (typeof coupling?.id !== 'string' || !coupling.id.trim()) {
    throw new Error('Pipeline coupling lookup returned no valid id.')
  }

  signal?.throwIfAborted()
  return platform.pipelineCoupling.delete(coupling.id)
}
