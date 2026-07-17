/* eslint-disable no-await-in-loop */
import type {ResourceCtx} from '../../../core/extend-resource.js'
import type {DomainOptions} from './types.js'

/**
 * Delete all custom domains from an app.
 *
 * Lists domains on the app, filters to kind === 'custom', and deletes
 * each in sequence. Heroku-owned domains (kind === 'heroku') are skipped.
 */
export async function clearCustomDomains(
  ctx: Pick<ResourceCtx, 'platform'>,
  appIdentity: string,
  options: DomainOptions = {},
): Promise<void> {
  const {signal} = options

  signal?.throwIfAborted()

  const platform = signal ? ctx.platform.withOptions({signal}) : ctx.platform

  // List and filter to custom domains
  const domains = await platform.domain.list(appIdentity)
  const customDomains = domains.filter(d => d.kind === 'custom')

  // Delete each in sequence
  for (const domain of customDomains) {
    signal?.throwIfAborted()

    await platform.domain.delete(appIdentity, domain.hostname)
  }
}
