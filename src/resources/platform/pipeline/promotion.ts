import type {
  PipelinePromotion,
  PipelinePromotionCreateOpts,
  PipelinePromotionTarget,
} from '@heroku/types/3.sdk'

import {HerokuApiClient} from '@heroku/heroku-fetch'
import createDebug from 'debug'

import type {ResourceCtx} from '../../../core/extend-resource.js'

import {extendResource} from '../../../core/extend-resource.js'
import {wait} from '../../../utils/wait.js'

const debug = createDebug('heroku:sdk:resources:pipeline-promotion')

export type ReleaseStreamContext = {
  stream: ReadableStream<Uint8Array>
  target: PipelinePromotionTarget
}

export type PromotePipelineOptions = {
  intervalMs?: number
  onReleaseStream?: (context: ReleaseStreamContext) => Promise<void> | void
  releaseStreamMaxAttempts?: number
  signal?: AbortSignal
  timeoutMs?: number
}

export type PromotePipelineResult = {
  promotion: PipelinePromotion
  targets: PipelinePromotionTarget[]
}

const DEFAULT_INTERVAL_MS = 1000
const DEFAULT_RELEASE_STREAM_MAX_ATTEMPTS = 100

export async function promotePipeline(
  ctx: Pick<ResourceCtx, 'platform'>,
  body: PipelinePromotionCreateOpts,
  options: PromotePipelineOptions = {},
): Promise<PromotePipelineResult> {
  const {
    intervalMs = DEFAULT_INTERVAL_MS,
    onReleaseStream,
    releaseStreamMaxAttempts = DEFAULT_RELEASE_STREAM_MAX_ATTEMPTS,
    signal,
    timeoutMs,
  } = options

  debug('promote source=%s targets=%d', body.source?.app?.id ?? '<unknown>', body.targets?.length ?? 0)
  const promotion = await ctx.platform.pipelinePromotion.create(body)
  if (!promotion.id) {
    throw new Error('Pipeline promotion response did not include an id')
  }

  debug('promote created promotion=%s intervalMs=%d timeoutMs=%s', promotion.id, intervalMs, timeoutMs ?? '<none>')

  const deadline = timeoutMs === undefined ? undefined : Date.now() + timeoutMs
  const streamRunner = onReleaseStream
    ? createReleaseStreamRunner(ctx, onReleaseStream, releaseStreamMaxAttempts, intervalMs, signal)
    : undefined

  let poll = 0
  while (true) {
    signal?.throwIfAborted()
    poll++

    // eslint-disable-next-line no-await-in-loop
    const targets = await ctx.platform.pipelinePromotionTarget.list(promotion.id)
    debug('promote poll=%d promotion=%s statuses=%o', poll, promotion.id, targets.map(target => target.status))
    if (targets.every(target => target.status !== 'pending')) {
      debug('promote terminal promotion=%s polls=%d', promotion.id, poll)
      return {promotion, targets}
    }

    // eslint-disable-next-line no-await-in-loop
    await streamRunner?.(targets)

    if (deadline !== undefined && Date.now() >= deadline) {
      throw new Error(`Pipeline promotion ${promotion.id} did not reach a terminal state within ${timeoutMs}ms`)
    }

    // eslint-disable-next-line no-await-in-loop
    await wait(intervalMs, signal)
  }
}

/**
 * Returns a function that, on first call where `targets` is a single
 * promotion target with `release.id` and `app.id`, fetches the release's
 * output stream and hands it to `onReleaseStream`. Subsequent calls are
 * no-ops; the stream is one-shot per promotion.
 */
function createReleaseStreamRunner(
  ctx: Pick<ResourceCtx, 'platform'>,
  onReleaseStream: NonNullable<PromotePipelineOptions['onReleaseStream']>,
  releaseStreamMaxAttempts: number,
  intervalMs: number,
  signal: AbortSignal | undefined,
): (targets: PipelinePromotionTarget[]) => Promise<void> {
  let handled = false
  return async targets => {
    if (handled || targets.length !== 1) return
    const target = targets[0]
    if (!target.release?.id || !target.app?.id) return

    handled = true
    debug('promote release-stream lookup app=%s release=%s', target.app.id, target.release.id)
    const release = await ctx.platform.release.info(target.app.id, target.release.id)
    if (!release.output_stream_url) {
      debug('promote release-stream skipped reason=no-output-stream-url')
      return
    }

    debug('promote release-stream fetching url=%s maxAttempts=%d', release.output_stream_url, releaseStreamMaxAttempts)
    const stream = await fetchReleaseOutput(
      release.output_stream_url,
      releaseStreamMaxAttempts,
      intervalMs,
      signal,
    )
    await onReleaseStream({stream, target})
  }
}

export const pipelinePromotionExtensions = extendResource('platform', 'pipelinePromotion', ctx => ({
  promote: (body: PipelinePromotionCreateOpts, options?: PromotePipelineOptions) =>
    promotePipeline(ctx, body, options),
}))

async function fetchReleaseOutput(
  url: string,
  maxAttempts: number,
  intervalMs: number,
  signal?: AbortSignal,
): Promise<ReadableStream<Uint8Array>> {
  const parsed = new URL(url)
  const path = `${parsed.pathname}${parsed.search}`
  // The release output URL points at a third-party stream host (e.g. busl).
  // Use a custom-service client so the platform prefixUrl and bearer token
  // don't leak across origins.
  const buslClient = new HerokuApiClient({
    baseUrl: parsed.origin,
    service: 'custom',
    token: '',
  })

  let attempt = 0
  while (true) {
    signal?.throwIfAborted()
    attempt++
    let response: Response | undefined
    try {
      // eslint-disable-next-line no-await-in-loop
      response = await buslClient.stream(path)
    } catch {
      // Treat HTTP errors thrown by the api-client as a retryable miss.
      response = undefined
    }

    if (response?.ok && response.body) {
      debug('release-stream attempt=%d status=%d ok stream=true', attempt, response.status)
      return response.body
    }

    debug('release-stream attempt=%d status=%s ok=false', attempt, response?.status ?? '<error>')

    if (response?.body) {
      // Drain so the connection can be reused.
      // eslint-disable-next-line no-await-in-loop
      await response.body.cancel().catch(() => {})
    }

    if (attempt >= maxAttempts) {
      throw new Error('stream release output not available')
    }

    // eslint-disable-next-line no-await-in-loop
    await wait(intervalMs, signal)
  }
}
