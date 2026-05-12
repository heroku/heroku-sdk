import type {HerokuApiClientOptions} from '@heroku/api-client'
import type {
  PipelinePromotion,
  PipelinePromotionCreateOpts,
  PipelinePromotionTarget,
} from '@heroku/types/3.sdk'

import {createPlatformClient} from '../services/platform.js'

export type PromotePipelineOptions = {
  clientOptions?: HerokuApiClientOptions
  intervalMs?: number
  signal?: AbortSignal
  timeoutMs?: number
}

export type PromotePipelineResult = {
  promotion: PipelinePromotion
  targets: PipelinePromotionTarget[]
}

const DEFAULT_INTERVAL_MS = 1000

export async function promotePipeline(
  body: PipelinePromotionCreateOpts,
  options: PromotePipelineOptions = {},
): Promise<PromotePipelineResult> {
  const {
    clientOptions,
    intervalMs = DEFAULT_INTERVAL_MS,
    signal,
    timeoutMs,
  } = options

  const client = createPlatformClient(clientOptions)
  const promotion = await client.pipelinePromotion.create(body)

  if (!promotion.id) {
    throw new Error('Pipeline promotion response did not include an id')
  }

  const deadline = timeoutMs === undefined ? undefined : Date.now() + timeoutMs

  while (true) {
    signal?.throwIfAborted()

    // eslint-disable-next-line no-await-in-loop
    const targets = await client.pipelinePromotionTarget.list(promotion.id)
    if (targets.every(target => target.status !== 'pending')) {
      return {promotion, targets}
    }

    if (deadline !== undefined && Date.now() >= deadline) {
      throw new Error(`Pipeline promotion ${promotion.id} did not reach a terminal state within ${timeoutMs}ms`)
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
