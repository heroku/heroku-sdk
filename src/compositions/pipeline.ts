import type {HerokuApiClientOptions} from '@heroku/api-client'
import type {
  PipelinePromotion,
  PipelinePromotionCreateOpts,
  PipelinePromotionTarget,
} from '@heroku/types/3.sdk'

import {HerokuApiClient} from '@heroku/api-client'

import {createPlatformClient} from '../services/platform.js'

export type ReleaseStreamContext = {
  stream: ReadableStream<Uint8Array>
  target: PipelinePromotionTarget
}

export type PromotePipelineOptions = {
  clientOptions?: HerokuApiClientOptions
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
  body: PipelinePromotionCreateOpts,
  options: PromotePipelineOptions = {},
): Promise<PromotePipelineResult> {
  const {
    clientOptions,
    intervalMs = DEFAULT_INTERVAL_MS,
    onReleaseStream,
    releaseStreamMaxAttempts = DEFAULT_RELEASE_STREAM_MAX_ATTEMPTS,
    signal,
    timeoutMs,
  } = options

  const platformClient = createPlatformClient(clientOptions)
  const promotion = await platformClient.pipelinePromotion.create(body)

  if (!promotion.id) {
    throw new Error('Pipeline promotion response did not include an id')
  }

  const deadline = timeoutMs === undefined ? undefined : Date.now() + timeoutMs

  let streamHandled = false

  while (true) {
    signal?.throwIfAborted()

    // eslint-disable-next-line no-await-in-loop
    const targets = await platformClient.pipelinePromotionTarget.list(promotion.id)

    if (targets.every(target => target.status !== 'pending')) {
      return {promotion, targets}
    }

    if (
      onReleaseStream
      && !streamHandled
      && targets.length === 1
      && targets[0].release?.id
      && targets[0].app?.id
    ) {
      streamHandled = true
      const target = targets[0]
      // eslint-disable-next-line no-await-in-loop
      const release = await platformClient.release.info(target.app!.id!, target.release!.id!)

      if (release.output_stream_url) {
        // eslint-disable-next-line no-await-in-loop
        const stream = await fetchReleaseOutput(
          release.output_stream_url,
          releaseStreamMaxAttempts,
          intervalMs,
          signal,
        )
        // eslint-disable-next-line no-await-in-loop
        await onReleaseStream({stream, target})
      }
    }

    if (deadline !== undefined && Date.now() >= deadline) {
      throw new Error(`Pipeline promotion ${promotion.id} did not reach a terminal state within ${timeoutMs}ms`)
    }

    // eslint-disable-next-line no-await-in-loop
    await wait(intervalMs, signal)
  }
}

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
      response = await buslClient.stream(path, {headers: {Accept: '*/*'}})
    } catch {
      // Treat HTTP errors thrown by the api-client as a retryable miss.
      response = undefined
    }

    if (response?.ok && response.body) {
      return response.body
    }

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

function wait(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    function onAbort() {
      clearTimeout(timer)
      reject(signal!.reason ?? new Error('Aborted'))
    }

    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)

    if (signal) {
      if (signal.aborted) {
        clearTimeout(timer)
        reject(signal.reason ?? new Error('Aborted'))
        return
      }

      signal.addEventListener('abort', onAbort, {once: true})
    }
  })
}
