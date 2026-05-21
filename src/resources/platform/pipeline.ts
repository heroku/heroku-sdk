import type {Pipeline} from '@heroku/types/3.sdk'

import type {ResourceCtx} from '../../core/extend-resource.js'

import {extendResource} from '../../core/extend-resource.js'

export type ResolvePipelineOptions = {
  signal?: AbortSignal
}

export class PipelineNotFoundError extends Error {
  public readonly id = 'not_found'
  public readonly statusCode = 404

  constructor(public readonly identity: string) {
    super(`Couldn't find a pipeline matching '${identity}'.`)
    this.name = 'PipelineNotFoundError'
  }

  public get body() {
    return {id: this.id, message: this.message, resource: 'pipeline'}
  }
}

export class PipelineAmbiguousError extends Error {
  public readonly id = 'multiple_matches'
  public readonly statusCode = 422

  constructor(public readonly identity: string, public readonly matches: Pipeline[]) {
    super(`Ambiguous identifier; multiple pipelines named '${identity}' found (${matches.length} matches).`)
    this.name = 'PipelineAmbiguousError'
  }

  public get body() {
    return {id: this.id, message: this.message}
  }
}

const UUID_RE = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i

/**
 * Resolve a Pipeline by identity.
 *
 * The identity may be:
 *   - a UUID — fetched directly via `pipeline.info`.
 *   - a name — looked up via `GET /pipelines?eq[name]=<name>`. Pipeline
 *     names are not unique platform-wide, so a name lookup may return
 *     zero, one, or many matches.
 *
 * Errors:
 *   - throws `PipelineNotFoundError` when no pipeline matches the name.
 *   - throws `PipelineAmbiguousError` when more than one does. Callers
 *     that want to prompt the user should catch this and inspect
 *     `error.matches`.
 */
export async function resolvePipeline(
  ctx: Pick<ResourceCtx, 'platform'>,
  identity: string,
  options: ResolvePipelineOptions = {},
): Promise<Pipeline> {
  options.signal?.throwIfAborted()

  if (UUID_RE.test(identity)) {
    return ctx.platform.pipeline.info(identity)
  }

  const matches = await ctx.platform
    .withSearchParams({'eq[name]': identity})
    .pipeline.list()

  if (matches.length === 0) {
    throw new PipelineNotFoundError(identity)
  }

  if (matches.length > 1) {
    throw new PipelineAmbiguousError(identity, matches)
  }

  return matches[0]
}

export const pipelineExtensions = extendResource('platform', 'pipeline', ctx => ({
  resolve: (identity: string, options?: ResolvePipelineOptions) =>
    resolvePipeline(ctx, identity, options),
}))
