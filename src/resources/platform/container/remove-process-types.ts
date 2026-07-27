import type {Formation, FormationUpdateOpts} from '@heroku/types/3.sdk'

import type {ResourceCtx} from '../../../core/extend-resource.js'
import type {ContainerOptions} from './index.js'

import {ensureContainerStack} from './ensure-container-stack.js'

/**
 * Extends `FormationUpdateOpts` to support the `3.docker-releases` API variant.
 *
 * The `docker_image` field is only available with
 * `Accept: application/vnd.heroku+json; version=3.docker-releases`
 */
type DockerReleasesUpdateOpts = FormationUpdateOpts & {
  docker_image: null
}

/**
 * Remove one or more process types from a container app
 */
export async function removeProcessTypes(
  ctx: Pick<ResourceCtx, 'platform'>,
  appIdentity: string,
  processTypes: string[],
  options: ContainerOptions = {},
): Promise<Formation[]> {
  await ensureContainerStack(ctx, appIdentity, options)

  const platform = options.signal ? ctx.platform.withOptions({signal: options.signal}) : ctx.platform

  // eslint-disable-next-line camelcase
  const requestBody: DockerReleasesUpdateOpts = {docker_image: null}

  const updatedFormations = await Promise.all(processTypes.map(processType => platform
    .withHeaders({Accept: 'application/vnd.heroku+json; version=3.docker-releases'})
    .formation.update(appIdentity, processType, requestBody)))

  return updatedFormations
}
