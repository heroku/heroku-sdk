import type {App} from '@heroku/types/3.sdk'

import type {ResourceCtx} from '../../../core/extend-resource.js'
import type {ContainerOptions} from './index.js'

export class NotAContainerAppError extends Error {
  public readonly id = 'not_a_container_app'

  constructor(public readonly app: Pick<App, 'build_stack' | 'id' | 'name' | 'stack'>) {
    super('This operation is for Docker apps only.')
    this.name = 'NotAContainerAppError'
  }

  public get body() {
    return {app: this.app, id: this.id, message: this.message}
  }
}

/**
 * Ensure that the given app is a container app.
 * @throws {NotAContainerAppError} if the app is not a container app
 */
export async function ensureContainerStack(
  ctx: Pick<ResourceCtx, 'platform'>,
  appIdentity: string,
  options: ContainerOptions = {},
): Promise<void> {
  const {signal} = options

  signal?.throwIfAborted()

  const platform = signal ? ctx.platform.withOptions({signal}) : ctx.platform

  const app = await platform.app.info(appIdentity)
  const allowedStack = 'container'

  if (app.build_stack.name !== allowedStack && app.stack.name !== allowedStack) {
    throw new NotAContainerAppError({
      // eslint-disable-next-line camelcase
      build_stack: app.build_stack,
      id: app.id,
      name: app.name,
      stack: app.stack,
    })
  }
}
