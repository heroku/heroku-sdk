import type {HerokuSDKOptions, ResourceCtx} from '../src/index.js'

const legacyResourceCtx: ResourceCtx = {
  dashboardBackend: {} as never,
  data: {} as never,
  metrics: {} as never,
  platform: {} as never,
  repositories: {} as never,
}

export {legacyResourceCtx}

const validOptions: HerokuSDKOptions<readonly []> = {
  clientOptionsByService: {
    dashboardBackend: {timeout: 1},
    data: {timeout: 2},
    metrics: {timeout: 3},
    platform: {timeout: 4},
    repositories: {timeout: 5},
    repositoriesApi: {timeout: 6},
  },
}

export {validOptions}

const optionsWithService = {service: 'custom' as const}

const invalidVariableOptions: HerokuSDKOptions<readonly []> = {
  clientOptionsByService: {
    // @ts-expect-error Keyed options cannot change the transport service.
    platform: optionsWithService,
  },
}

export {invalidVariableOptions}

const invalidInlineOptions: HerokuSDKOptions<readonly []> = {
  clientOptionsByService: {
    // @ts-expect-error Keyed options cannot change the transport service.
    repositoriesApi: {service: 'custom'},
  },
}

export {invalidInlineOptions}
