import type {Release} from '@heroku/types/3.sdk'

import type {ResourceCtx} from '../../../core/extend-resource.js'
import type {ContainerOptions} from './index.js'

import {ensureContainerStack} from './ensure-container-stack.js'

/**
 * An update item for the `3.docker-releases` API variant.
 *
 * The `docker_image` field is only available with
 * `Accept: application/vnd.heroku+json; version=3.docker-releases`
 */
export type DockerReleasesBatchUpdateOpts = {
  docker_image: string
  type: string
}

export type ReleaseDockerImagesResult = {
  newRelease: Release | undefined
  oldRelease: Release | undefined
}

/**
 * Release Docker images to a container app.
 */
export async function releaseDockerImages(
  ctx: Pick<ResourceCtx, 'platform'>,
  appIdentity: string,
  imagesByProcessType: DockerReleasesBatchUpdateOpts[],
  options: ContainerOptions = {},
): Promise<ReleaseDockerImagesResult> {
  await ensureContainerStack(ctx, appIdentity, options)

  const platform = options.signal ? ctx.platform.withOptions({signal: options.signal}) : ctx.platform

  const oldReleases = await platform
    .withHeaders({Range: 'version ..; max=1, order=desc'})
    .release.list(appIdentity)
  const oldRelease = oldReleases[0]

  await platform
    .withHeaders({Accept: 'application/vnd.heroku+json; version=3.docker-releases'})
    .formation.batchUpdate(appIdentity, {updates: imagesByProcessType})

  const newReleases = await platform
    .withHeaders({Range: 'version ..; max=1, order=desc'})
    .release.list(appIdentity)
  const newRelease = newReleases[0]

  return {
    newRelease,
    oldRelease,
  }
}
