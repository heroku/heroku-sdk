import type { HerokuApiClientOptions } from '@heroku/api-client'
import type {
  App,
  PipelineCoupling,
  PipelinePromotion,
  PipelinePromotionCreateOpts,
  PipelinePromotionTarget,
} from '@heroku/types/3.sdk'

import type { ResourceCtx } from '../core/extend-resource.js'

import * as pipelinePromotionResource from '../resources/platform/pipeline-promotion.js'
import { createDataClient } from '../services/data.js'
import { createPlatformClient } from '../services/platform.js'

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

export type PromotePipelineResult = pipelinePromotionResource.PromotePipelineResult

function makeCtx(options: PromotePipelineOptions): ResourceCtx {
  let platform: ReturnType<typeof createPlatformClient> | undefined
  let data: ReturnType<typeof createDataClient> | undefined
  return {
    get data() {
      data ??= createDataClient(options.clientOptions)
      return data
    },
    get platform() {
      platform ??= createPlatformClient(options.clientOptions)
      return platform
    },
  }
}

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
      return { promotion, targets }
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
        await onReleaseStream({ stream, target })
      }
    }

    if (deadline !== undefined && Date.now() >= deadline) {
      throw new Error(`Pipeline promotion ${promotion.id} did not reach a terminal state within ${timeoutMs}ms`)
    }

    // eslint-disable-next-line no-await-in-loop
    await wait(intervalMs, signal)
  }
}

export async function listPipelineApps(
  pipelineId: string,
  options: ListPipelineAppsOptions = {},
): Promise<AppWithPipelineCoupling[]> {
  options.signal?.throwIfAborted()
  const platformClient = createPlatformClient(options.clientOptions)
  const allCouplings = await platformClient.pipelineCoupling.listByPipeline(pipelineId)
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

    options.onWarning({ limit: APPS_FILTER_LIMIT, pipelineId, type: 'apps_truncated' })
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
  const response = await apiClient.post('/filters/apps', { in: { id: ids } }, {
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
      response = await buslClient.stream(path, { headers: { Accept: '*/*' } })
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
      await response.body.cancel().catch(() => { })
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

      signal.addEventListener('abort', onAbort, { once: true })
    }
  })
}
