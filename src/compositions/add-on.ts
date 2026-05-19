import type {HerokuApiClientOptions} from '@heroku/api-client'
import type {AddOn} from '@heroku/types/3.sdk'

import {createPlatformClient} from '../services/platform.js'

export type AddOnOptions = {
  clientOptions?: HerokuApiClientOptions
  signal?: AbortSignal
}

export async function upgrade(
  appIdentity: string,
  addOnIdentity: string,
  plan: string,
  options: AddOnOptions = {},
): Promise<AddOn> {
  options.signal?.throwIfAborted()
  const client = createPlatformClient(options.clientOptions)
  return client.addOn.update(appIdentity, addOnIdentity, {plan})
}
