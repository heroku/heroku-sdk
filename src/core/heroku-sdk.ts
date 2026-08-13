import type {HerokuApiClientOptions} from '@heroku/heroku-fetch'

import type {DataClient} from '../services/data.js'
import type {MetricsClient} from '../services/metrics.js'
import type {PlatformClient} from '../services/platform.js'
import type {RepositoriesClient} from '../services/repositories.js'
import type {
  ApplyExtensions,
  ExtensionsFor,
  ResourceCtx,
  ResourceExtension,
  ServiceName,
} from './extend-resource.js'

import {createDataClient} from '../services/data.js'
import {createMetricsClient} from '../services/metrics.js'
import {createPlatformClient} from '../services/platform.js'
import {createRepositoriesClient} from '../services/repositories.js'
import {mergeExtensions} from './extensions-proxy.js'

export type HerokuSDKOptions<Exts extends readonly ResourceExtension[]> = {
  clientOptions?: HerokuApiClientOptions
  extensions?: Exts
}

function partitionByService(extensions: readonly ResourceExtension[]): Map<ServiceName, ResourceExtension[]> {
  const map = new Map<ServiceName, ResourceExtension[]>()
  for (const ext of extensions) {
    const list = map.get(ext.service) ?? []
    list.push(ext)
    map.set(ext.service, list)
  }

  return map
}

export class HerokuSDK<
  const Exts extends readonly ResourceExtension[] = readonly ResourceExtension[],
> {
  readonly #clientOptions: HerokuApiClientOptions
  #ctx: ResourceCtx | undefined
  #data: unknown
  readonly #extensionsByService: Map<ServiceName, ResourceExtension[]>
  #metrics: unknown
  #platform: unknown
  #rawData: DataClient | undefined
  #rawMetrics: MetricsClient | undefined
  #rawPlatform: PlatformClient | undefined
  #rawRepositories: RepositoriesClient | undefined
  #repositories: unknown

  constructor(options: HerokuSDKOptions<Exts> = {}) {
    this.#clientOptions = options.clientOptions ?? {}
    this.#extensionsByService = partitionByService(options.extensions ?? [])
  }

  get data(): ApplyExtensions<DataClient, ExtensionsFor<Exts, 'data'>> {
    this.#data ??= mergeExtensions(
      this.#getRawData(),
      this.#extensionsByService.get('data') ?? [],
      this.#getCtx(),
    )

    return this.#data as ApplyExtensions<DataClient, ExtensionsFor<Exts, 'data'>>
  }

  get metrics(): ApplyExtensions<MetricsClient, ExtensionsFor<Exts, 'metrics'>> {
    this.#metrics ??= mergeExtensions(
      this.#getRawMetrics(),
      this.#extensionsByService.get('metrics') ?? [],
      this.#getCtx(),
    )

    return this.#metrics as ApplyExtensions<MetricsClient, ExtensionsFor<Exts, 'metrics'>>
  }

  get platform(): ApplyExtensions<PlatformClient, ExtensionsFor<Exts, 'platform'>> {
    this.#platform ??= mergeExtensions(
      this.#getRawPlatform(),
      this.#extensionsByService.get('platform') ?? [],
      this.#getCtx(),
    )

    return this.#platform as ApplyExtensions<PlatformClient, ExtensionsFor<Exts, 'platform'>>
  }

  get repositories(): ApplyExtensions<RepositoriesClient, ExtensionsFor<Exts, 'repositories'>> {
    this.#repositories ??= mergeExtensions(
      this.#getRawRepositories(),
      this.#extensionsByService.get('repositories') ?? [],
      this.#getCtx(),
    )

    return this.#repositories as ApplyExtensions<RepositoriesClient, ExtensionsFor<Exts, 'repositories'>>
  }

  #getCtx(): ResourceCtx {
    this.#ctx ??= Object.defineProperties({} as ResourceCtx, {
      data: {
        enumerable: true,
        get: () => this.#getRawData(),
      },
      metrics: {
        enumerable: true,
        get: () => this.#getRawMetrics(),
      },
      platform: {
        enumerable: true,
        get: () => this.#getRawPlatform(),
      },
      repositories: {
        enumerable: true,
        get: () => this.#getRawRepositories(),
      },
    })

    return this.#ctx
  }

  #getRawData(): DataClient {
    this.#rawData ??= createDataClient(this.#clientOptions)
    return this.#rawData
  }

  #getRawMetrics(): MetricsClient {
    this.#rawMetrics ??= createMetricsClient(this.#clientOptions)
    return this.#rawMetrics
  }

  #getRawPlatform(): PlatformClient {
    this.#rawPlatform ??= createPlatformClient(this.#clientOptions)
    return this.#rawPlatform
  }

  #getRawRepositories(): RepositoriesClient {
    this.#rawRepositories ??= createRepositoriesClient(this.#clientOptions)
    return this.#rawRepositories
  }
}
