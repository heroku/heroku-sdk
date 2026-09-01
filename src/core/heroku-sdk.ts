import type {HerokuApiClientOptions} from '@heroku/heroku-fetch'

import type {DashboardBackendClient} from '../services/dashboard-backend.js'
import type {DataClient} from '../services/data.js'
import type {MetricsClient} from '../services/metrics.js'
import type {PlatformClient} from '../services/platform.js'
import type {RepositoriesApiClient} from '../services/repositories-api.js'
import type {RepositoriesClient} from '../services/repositories.js'
import type {
  ApplyExtensions,
  ExtensionsFor,
  ResourceCtx,
  ResourceExtension,
  ServiceName,
} from './extend-resource.js'

import {createDashboardBackendClient} from '../services/dashboard-backend.js'
import {createDataClient} from '../services/data.js'
import {createMetricsClient} from '../services/metrics.js'
import {createPlatformClient} from '../services/platform.js'
import {createRepositoriesApiClient} from '../services/repositories-api.js'
import {createRepositoriesClient} from '../services/repositories.js'
import {mergeExtensions} from './extensions-proxy.js'

type ServiceClientOptions = Omit<HerokuApiClientOptions, 'service'> & {
  service?: never
}

export type HerokuSDKOptions<Exts extends readonly ResourceExtension[]> = {
  clientOptions?: HerokuApiClientOptions
  /** Shallow per-service overrides applied after common clientOptions. */
  clientOptionsByService?: Partial<Record<ServiceName, ServiceClientOptions>>
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
  readonly #clientOptionsByService: Partial<Record<ServiceName, ServiceClientOptions>>
  #ctx: ResourceCtx | undefined
  #dashboardBackend: unknown
  #data: unknown
  readonly #extensionsByService: Map<ServiceName, ResourceExtension[]>
  #metrics: unknown
  #platform: unknown
  #rawDashboardBackend: DashboardBackendClient | undefined
  #rawData: DataClient | undefined
  #rawMetrics: MetricsClient | undefined
  #rawPlatform: PlatformClient | undefined
  #rawRepositories: RepositoriesClient | undefined
  #rawRepositoriesApi: RepositoriesApiClient | undefined
  #repositories: unknown
  #repositoriesApi: unknown

  constructor(options: HerokuSDKOptions<Exts> = {}) {
    this.#clientOptions = options.clientOptions ?? {}
    this.#clientOptionsByService = options.clientOptionsByService ?? {}
    this.#extensionsByService = partitionByService(options.extensions ?? [])
  }

  get dashboardBackend(): ApplyExtensions<DashboardBackendClient, ExtensionsFor<Exts, 'dashboardBackend'>> {
    this.#dashboardBackend ??= mergeExtensions(
      this.#getRawDashboardBackend(),
      this.#extensionsByService.get('dashboardBackend') ?? [],
      this.#getCtx(),
    )

    return this.#dashboardBackend as ApplyExtensions<DashboardBackendClient, ExtensionsFor<Exts, 'dashboardBackend'>>
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

  get repositoriesApi(): ApplyExtensions<RepositoriesApiClient, ExtensionsFor<Exts, 'repositoriesApi'>> {
    this.#repositoriesApi ??= mergeExtensions(
      this.#getRawRepositoriesApi(),
      this.#extensionsByService.get('repositoriesApi') ?? [],
      this.#getCtx(),
    )

    return this.#repositoriesApi as ApplyExtensions<RepositoriesApiClient, ExtensionsFor<Exts, 'repositoriesApi'>>
  }

  #getClientOptions(service: ServiceName): HerokuApiClientOptions {
    const serviceOverride = this.#clientOptionsByService[service] as HerokuApiClientOptions | undefined
    const serviceOptions = {...serviceOverride}
    delete serviceOptions.service
    return {
      ...this.#clientOptions,
      ...serviceOptions,
    }
  }

  #getCtx(): ResourceCtx {
    this.#ctx ??= Object.defineProperties({} as ResourceCtx, {
      dashboardBackend: {
        enumerable: true,
        get: () => this.#getRawDashboardBackend(),
      },
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
      repositoriesApi: {
        enumerable: true,
        get: () => this.#getRawRepositoriesApi(),
      },
    })

    return this.#ctx
  }

  #getRawDashboardBackend(): DashboardBackendClient {
    this.#rawDashboardBackend ??= createDashboardBackendClient(this.#getClientOptions('dashboardBackend'))
    return this.#rawDashboardBackend
  }

  #getRawData(): DataClient {
    this.#rawData ??= createDataClient(this.#getClientOptions('data'))
    return this.#rawData
  }

  #getRawMetrics(): MetricsClient {
    this.#rawMetrics ??= createMetricsClient(this.#getClientOptions('metrics'))
    return this.#rawMetrics
  }

  #getRawPlatform(): PlatformClient {
    this.#rawPlatform ??= createPlatformClient(this.#getClientOptions('platform'))
    return this.#rawPlatform
  }

  #getRawRepositories(): RepositoriesClient {
    this.#rawRepositories ??= createRepositoriesClient(this.#getClientOptions('repositories'))
    return this.#rawRepositories
  }

  #getRawRepositoriesApi(): RepositoriesApiClient {
    this.#rawRepositoriesApi ??= createRepositoriesApiClient(this.#getClientOptions('repositoriesApi'))
    return this.#rawRepositoriesApi
  }
}
