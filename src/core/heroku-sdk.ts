import type { HerokuApiClientOptions } from '@heroku/heroku-fetch'

import type { DataClient } from '../services/data.js'
import type { PlatformClient } from '../services/platform.js'
import type {
  ApplyExtensions,
  ExtensionsFor,
  ResourceCtx,
  ResourceExtension,
  ServiceName,
} from './extend-resource.js'

import { createDataClient } from '../services/data.js'
import { createPlatformClient } from '../services/platform.js'
import { mergeExtensions } from './extensions-proxy.js'

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
  #platform: unknown
  #rawData: DataClient | undefined
  #rawPlatform: PlatformClient | undefined

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

  get platform(): ApplyExtensions<PlatformClient, ExtensionsFor<Exts, 'platform'>> {
    this.#platform ??= mergeExtensions(
      this.#getRawPlatform(),
      this.#extensionsByService.get('platform') ?? [],
      this.#getCtx(),
    )

    return this.#platform as ApplyExtensions<PlatformClient, ExtensionsFor<Exts, 'platform'>>
  }

  #getCtx(): ResourceCtx {
    this.#ctx ??= Object.defineProperties({} as ResourceCtx, {
      data: {
        enumerable: true,
        get: () => this.#getRawData(),
      },
      platform: {
        enumerable: true,
        get: () => this.#getRawPlatform(),
      },
    })

    return this.#ctx
  }

  #getRawData(): DataClient {
    this.#rawData ??= createDataClient(this.#clientOptions)
    return this.#rawData
  }

  #getRawPlatform(): PlatformClient {
    this.#rawPlatform ??= createPlatformClient(this.#clientOptions)
    return this.#rawPlatform
  }
}
