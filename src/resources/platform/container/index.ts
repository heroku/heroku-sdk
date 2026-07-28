import {extendResource} from '../../../core/extend-resource.js'
import {ensureContainerStack} from './ensure-container-stack.js'
import {type DockerReleasesBatchUpdateOpts, releaseDockerImages} from './release-images.js'
import {removeProcessTypes} from './remove-process-types.js'

export {ensureContainerStack, NotAContainerAppError} from './ensure-container-stack.js'
export {type DockerReleasesBatchUpdateOpts, releaseDockerImages, type ReleaseDockerImagesResult} from './release-images.js'
export {removeProcessTypes} from './remove-process-types.js'

export type ContainerOptions = {
  signal?: AbortSignal
}

export const containerExtensions = extendResource('platform', 'container', ctx => ({
  ensureContainerStack: (
    appIdentity: string,
    options?: ContainerOptions,
  ) => ensureContainerStack(ctx, appIdentity, options),
  releaseImages: (
    appIdentity: string,
    imagesByProcessType: DockerReleasesBatchUpdateOpts[],
    options?: ContainerOptions,
  ) => releaseDockerImages(ctx, appIdentity, imagesByProcessType, options),
  removeProcessTypes: (
    appIdentity: string,
    processTypes: string[],
    options?: ContainerOptions,
  ) => removeProcessTypes(ctx, appIdentity, processTypes, options),
}))
