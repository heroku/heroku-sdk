/* eslint-disable camelcase */
import * as repositoriesApiRoutes from '@heroku/types/repositories-api/routes'
import {
  afterEach, describe, expect, it, vi,
} from 'vitest'

import type {ResourceCtx} from '../../../core/extend-resource.js'

import {HerokuSDK} from '../../../core/heroku-sdk.js'
import {debug} from './debug.js'
import {resolveRepoName, reviewAppConfigExtensions} from './index.js'

vi.mock('./debug.js', () => ({debug: vi.fn()}))

afterEach(() => {
  vi.mocked(debug).mockClear()
  vi.unstubAllGlobals()
})

type FakeClient<T> = T & {
  withOptions: ReturnType<typeof vi.fn>
}

function buildCtx() {
  const platform = {
    accountFeature: {info: vi.fn()},
    reviewAppConfig: {
      delete: vi.fn(),
      enable: vi.fn(),
      info: vi.fn(),
      update: vi.fn(),
    },
    withOptions: vi.fn(),
  }
  platform.withOptions.mockReturnValue(platform)

  const repositoriesApi = {
    githubRepository: {info: vi.fn()},
    withOptions: vi.fn(),
  }
  repositoriesApi.withOptions.mockReturnValue(repositoriesApi)

  const repositories = {
    pipelineRepository: {info: vi.fn()},
    withOptions: vi.fn(),
  }
  repositories.withOptions.mockReturnValue(repositories)

  return {
    ctx: {platform, repositories, repositoriesApi} as unknown as Pick<
      ResourceCtx,
      'platform' | 'repositories' | 'repositoriesApi'
    >,
    platform,
    repositories: repositories as FakeClient<typeof repositories>,
    repositoriesApi: repositoriesApi as FakeClient<typeof repositoriesApi>,
  }
}

describe('resolveRepoName', () => {
  it('uses the repositories API full name when the account feature is enabled', async () => {
    const {ctx, platform, repositories, repositoriesApi} = buildCtx()
    platform.accountFeature.info.mockResolvedValue({enabled: true})
    repositoriesApi.githubRepository.info.mockResolvedValue({full_name: 'owner/repo'})

    await expect(resolveRepoName(ctx, 'pipeline-id')).resolves.toBe('owner/repo')
    expect(platform.accountFeature.info).toHaveBeenCalledExactlyOnceWith('dashboard-repositories-api')
    expect(repositoriesApi.githubRepository.info).toHaveBeenCalledExactlyOnceWith('pipeline-id')
    expect(repositories.pipelineRepository.info).not.toHaveBeenCalled()
  })

  it('falls back when the feature is disabled', async () => {
    const {ctx, platform, repositories, repositoriesApi} = buildCtx()
    platform.accountFeature.info.mockResolvedValue({enabled: false})
    repositories.pipelineRepository.info.mockResolvedValue({repository: {name: 'owner/repo'}})

    await expect(resolveRepoName(ctx, 'pipeline-id')).resolves.toBe('owner/repo')
    expect(repositoriesApi.githubRepository.info).not.toHaveBeenCalled()
    expect(repositories.pipelineRepository.info).toHaveBeenCalledExactlyOnceWith('pipeline-id')
    expect(debug).toHaveBeenCalledWith('repositories API disabled; falling back')
  })

  it.each([
    ['feature lookup fails', 'feature', new Error('feature unavailable')],
    ['repositories API lookup fails', 'repositoriesApi', new Error('repository unavailable')],
    ['repositories API response has no usable full name', 'invalid', undefined],
  ])('falls back when %s', async (_label, failurePoint, failure) => {
    const {ctx, platform, repositories, repositoriesApi} = buildCtx()
    platform.accountFeature.info.mockResolvedValue({enabled: true})

    if (failurePoint === 'feature') platform.accountFeature.info.mockRejectedValue(failure)
    else if (failurePoint === 'repositoriesApi') repositoriesApi.githubRepository.info.mockRejectedValue(failure)
    else repositoriesApi.githubRepository.info.mockResolvedValue({full_name: '  '})

    repositories.pipelineRepository.info.mockResolvedValue({repository: {name: 'owner/repo'}})

    await expect(resolveRepoName(ctx, 'pipeline-id')).resolves.toBe('owner/repo')
    expect(repositories.pipelineRepository.info).toHaveBeenCalledExactlyOnceWith('pipeline-id')
    expect(vi.mocked(debug).mock.calls[0]?.[0]).toContain('falling back')
    expect(vi.mocked(debug).mock.calls.flat()).not.toContain('pipeline-id')
  })

  it('normalizes repository names from either service', async () => {
    const primary = buildCtx()
    primary.platform.accountFeature.info.mockResolvedValue({enabled: true})
    primary.repositoriesApi.githubRepository.info.mockResolvedValue({full_name: ' owner/repo '})
    await expect(resolveRepoName(primary.ctx, 'pipeline-id')).resolves.toBe('owner/repo')

    const fallback = buildCtx()
    fallback.platform.accountFeature.info.mockResolvedValue({enabled: false})
    fallback.repositories.pipelineRepository.info.mockResolvedValue({repository: {name: ' owner/repo '}})
    await expect(resolveRepoName(fallback.ctx, 'pipeline-id')).resolves.toBe('owner/repo')
  })

  it('rejects an unusable fallback repository name', async () => {
    const {ctx, platform, repositories} = buildCtx()
    platform.accountFeature.info.mockResolvedValue({enabled: false})
    repositories.pipelineRepository.info.mockResolvedValue({repository: {name: '  '}})

    await expect(resolveRepoName(ctx, 'pipeline-id')).rejects
      .toThrow('Repositories service returned no repository name')
  })

  it('propagates a fallback failure', async () => {
    const {ctx, platform, repositories} = buildCtx()
    const error = new Error('fallback failed')
    platform.accountFeature.info.mockResolvedValue({enabled: false})
    repositories.pipelineRepository.info.mockRejectedValue(error)

    await expect(resolveRepoName(ctx, 'pipeline-id')).rejects.toBe(error)
  })

  it('passes the signal to every client used by the successful primary path', async () => {
    const {ctx, platform, repositories, repositoriesApi} = buildCtx()
    const {signal} = new AbortController()
    platform.accountFeature.info.mockResolvedValue({enabled: true})
    repositoriesApi.githubRepository.info.mockResolvedValue({full_name: 'owner/repo'})

    await resolveRepoName(ctx, 'pipeline-id', {signal})

    expect(platform.withOptions).toHaveBeenCalledExactlyOnceWith({signal})
    expect(repositoriesApi.withOptions).toHaveBeenCalledExactlyOnceWith({signal})
    expect(repositories.withOptions).not.toHaveBeenCalled()
  })

  it('passes the signal to fallback and starts no traffic for an already-aborted signal', async () => {
    const first = buildCtx()
    const {signal} = new AbortController()
    first.platform.accountFeature.info.mockResolvedValue({enabled: false})
    first.repositories.pipelineRepository.info.mockResolvedValue({repository: {name: 'owner/repo'}})

    await resolveRepoName(first.ctx, 'pipeline-id', {signal})
    expect(first.repositories.withOptions).toHaveBeenCalledExactlyOnceWith({signal})

    const aborted = buildCtx()
    const controller = new AbortController()
    controller.abort()

    await expect(resolveRepoName(aborted.ctx, 'pipeline-id', {signal: controller.signal})).rejects.toThrow()
    expect(aborted.platform.accountFeature.info).not.toHaveBeenCalled()
    expect(aborted.repositoriesApi.githubRepository.info).not.toHaveBeenCalled()
    expect(aborted.repositories.pipelineRepository.info).not.toHaveBeenCalled()
  })

  it('does not start fallback traffic when a request aborts', async () => {
    const {ctx, platform, repositories, repositoriesApi} = buildCtx()
    const controller = new AbortController()
    platform.accountFeature.info.mockResolvedValue({enabled: true})
    repositoriesApi.githubRepository.info.mockImplementation(async () => {
      controller.abort()
      throw controller.signal.reason
    })

    await expect(resolveRepoName(ctx, 'pipeline-id', {signal: controller.signal})).rejects.toThrow()
    expect(repositories.pipelineRepository.info).not.toHaveBeenCalled()
  })

  it('does not start repository traffic when feature lookup aborts', async () => {
    const {ctx, platform, repositories, repositoriesApi} = buildCtx()
    const controller = new AbortController()
    platform.accountFeature.info.mockImplementation(async () => {
      controller.abort()
      throw controller.signal.reason
    })

    await expect(resolveRepoName(ctx, 'pipeline-id', {signal: controller.signal})).rejects.toThrow()
    expect(repositoriesApi.githubRepository.info).not.toHaveBeenCalled()
    expect(repositories.pipelineRepository.info).not.toHaveBeenCalled()
  })

  it('does not continue when feature lookup resolves as the signal aborts', async () => {
    const {ctx, platform, repositories, repositoriesApi} = buildCtx()
    const controller = new AbortController()
    const reason = new Error('aborted')
    platform.accountFeature.info.mockImplementation(async () => {
      controller.abort(reason)
      return {enabled: true}
    })

    await expect(resolveRepoName(ctx, 'pipeline-id', {signal: controller.signal})).rejects.toBe(reason)
    expect(repositoriesApi.githubRepository.info).not.toHaveBeenCalled()
    expect(repositories.pipelineRepository.info).not.toHaveBeenCalled()
  })

  it('does not return a primary result that resolves as the signal aborts', async () => {
    const {ctx, platform, repositories, repositoriesApi} = buildCtx()
    const controller = new AbortController()
    const reason = new Error('aborted')
    platform.accountFeature.info.mockResolvedValue({enabled: true})
    repositoriesApi.githubRepository.info.mockImplementation(async () => {
      controller.abort(reason)
      return {full_name: 'owner/repo'}
    })

    await expect(resolveRepoName(ctx, 'pipeline-id', {signal: controller.signal})).rejects.toBe(reason)
    expect(repositories.pipelineRepository.info).not.toHaveBeenCalled()
  })

  it('does not return a fallback result that resolves as the signal aborts', async () => {
    const {ctx, platform, repositories} = buildCtx()
    const controller = new AbortController()
    const reason = new Error('aborted')
    platform.accountFeature.info.mockResolvedValue({enabled: false})
    repositories.pipelineRepository.info.mockImplementation(async () => {
      controller.abort(reason)
      return {repository: {name: 'owner/repo'}}
    })

    await expect(resolveRepoName(ctx, 'pipeline-id', {signal: controller.signal})).rejects.toBe(reason)
  })
})

describe('reviewAppConfigExtensions', () => {
  it('targets platform.reviewAppConfig and exposes resolveRepoName', () => {
    expect(reviewAppConfigExtensions.service).toBe('platform')
    expect(reviewAppConfigExtensions.resource).toBe('reviewAppConfig')
    expect(typeof reviewAppConfigExtensions.factory(buildCtx().ctx as ResourceCtx).resolveRepoName).toBe('function')
  })

  it('rejects a direct extension context without the repositories API client', () => {
    const {ctx} = buildCtx()
    const legacyCtx = {...ctx}
    delete legacyCtx.repositoriesApi

    expect(() => reviewAppConfigExtensions.factory(legacyCtx as ResourceCtx))
      .toThrow('reviewAppConfigExtensions requires ResourceCtx.repositoriesApi')
  })

  it('is wired onto the SDK without replacing generated CRUD methods', () => {
    const sdk = new HerokuSDK({extensions: [reviewAppConfigExtensions]})

    expect(typeof sdk.platform.reviewAppConfig.resolveRepoName).toBe('function')
    expect(typeof sdk.platform.reviewAppConfig.update).toBe('function')
  })

  it('uses the released repositories API route contract', () => {
    expect(repositoriesApiRoutes.githubRepository.info).toEqual({
      method: 'GET',
      path: '/pipelines/{pipelineIdentity}/repo',
    })
  })

  it('executes the resolver through the SDK extension context', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({enabled: true}), {
      headers: {'content-type': 'application/json'},
      status: 200,
    })).mockResolvedValueOnce(new Response(JSON.stringify({full_name: 'owner/repo'}), {
      headers: {'content-type': 'application/json'},
      status: 200,
    }))
    vi.stubGlobal('fetch', fetch)
    const sdk = new HerokuSDK({
      clientOptions: {token: 'test-token'},
      extensions: [reviewAppConfigExtensions],
    })

    await expect(sdk.platform.reviewAppConfig.resolveRepoName('pipeline-id')).resolves.toBe('owner/repo')
    expect(fetch).toHaveBeenCalledTimes(2)
    const featureRequest = fetch.mock.calls[0][0] as Request
    const repositoryRequest = fetch.mock.calls[1][0] as Request
    expect(featureRequest.url).toBe('https://api.heroku.com/account/features/dashboard-repositories-api')
    expect(repositoryRequest.url).toBe('https://api.heroku.com/pipelines/pipeline-id/repo')
    expect(repositoryRequest.headers.get('accept')).toBe('application/vnd.heroku+json; version=3.repositories-api')
  })
})
