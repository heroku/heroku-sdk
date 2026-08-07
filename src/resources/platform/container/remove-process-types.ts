/* eslint-disable no-await-in-loop */
import type {Formation, FormationUpdateOpts} from '@heroku/types/3.sdk'

import type {ResourceCtx} from '../../../core/extend-resource.js'
import type {Poller} from '../../../utils/poller.js'
import type {ContainerOptions} from './index.js'

import {ensureContainerStack} from './ensure-container-stack.js'

export type RemoveProcessTypesOpts = {
  /**
   * Fires `poller.onStart` immediately before, and `poller.onStop`
   * immediately after, each process type's `formation.update` call. Process
   * types are removed one at a time (not concurrently) so a caller can
   * drive a single shared UI element (e.g. a CLI spinner) across the whole
   * batch. If an update rejects, its `onStart` has already fired but
   * `onStop` never will — the rejection propagates immediately and any
   * remaining process types are not attempted.
   */
  poller?: Poller<string>
} & ContainerOptions

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
  options: RemoveProcessTypesOpts = {},
): Promise<Formation[]> {
  await ensureContainerStack(ctx, appIdentity, options)

  const platform = options.signal ? ctx.platform.withOptions({signal: options.signal}) : ctx.platform

  // eslint-disable-next-line camelcase
  const requestBody: DockerReleasesUpdateOpts = {docker_image: null}

  const updatedFormations: Formation[] = []

  for (const processType of processTypes) {
    options.poller?.onStart?.(processType)
    const formation = await platform
      .withHeaders({Accept: 'application/vnd.heroku+json; version=3.docker-releases'})
      .formation.update(appIdentity, processType, requestBody)
    options.poller?.onStop?.(processType)

    updatedFormations.push(formation)
  }

  return updatedFormations
}
