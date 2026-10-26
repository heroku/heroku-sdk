import type {AddOnAttachment} from '@heroku/types/3.sdk'
import type {PostgresDatabaseDeleteCredentialResult} from '@heroku/types/data'

import type {ResourceCtx} from '../../../core/extend-resource.js'
import type {ResolvedAddOn} from '../../platform/add-on/types.js'
import type {DatabaseCredentialOptions} from './index.js'

import {withSignal} from '../../../core/with-signal.js'
import {resolveAddonInternal} from '../../platform/add-on/resolve.js'
import {parseAttachmentFactors} from '../internal/parse-attachment-factors.js'
import {
  getPostgresServiceName, isAdvancedDatabase, isEssentialDatabase, isLegacyEssentialDatabase,
} from '../internal/postgres-utils.js'

export type DestroyDatabaseCredentialResult = {
  addon: ResolvedAddOn
  result: PostgresDatabaseDeleteCredentialResult | void
}

/**
 * Destroys a credential on a Postgres database, dispatching to the
 * Advanced-tier or classic-tier endpoint based on the resolved add-on's plan.
 *
 * The owner credential (Advanced tier) and the default credential (classic/Essential
 * tier) can't be destroyed, custom credentials can't be destroyed on Essential-tier
 * databases, and a credential still attached to any app must be detached first.
 */
export async function destroy(
  ctx: Pick<ResourceCtx, 'data' | 'platform'>,
  addonIdentity: string,
  credName: string,
  options: DatabaseCredentialOptions = {},
): Promise<DestroyDatabaseCredentialResult> {
  const {appIdentity, signal} = options
  signal?.throwIfAborted()
  // Bind the signal so the resolve and destroy requests abort in flight.
  const platform = withSignal(ctx.platform, signal)
  const addon = await resolveAddonInternal(platform, addonIdentity, {
    addonService: getPostgresServiceName(), appIdentity,
  })
  const data = withSignal(ctx.data, signal)
  const isEssentialTier = isEssentialDatabase(addon)
  const isLegacyEssentialTier = isLegacyEssentialDatabase(addon)
  const isAdvancedTier = isAdvancedDatabase(addon)

  let credAttachments: AddOnAttachment[] = []

  if (isAdvancedTier) {
    const [{items: availableCreds}, attachments] = await Promise.all([
      data.postgresCredential.list(addon.id),
      platform.addOnAttachment.listByAddOn(addon.id),
    ])
    const ownerCred = availableCreds.find(cred => cred.type === 'owner')
    if (ownerCred?.name === credName) {
      throw new Error('You can\'t destroy the owner credential.')
    }

    credAttachments = attachments.filter(a => parseAttachmentFactors(a.namespace).role === credName)
  } else if (isEssentialTier) {
    throw new Error('You can\'t destroy custom credentials on Essential-tier databases.')
  } else if (isLegacyEssentialTier || credName === 'default') {
    throw new Error('You can\'t destroy the default credential.')
  } else {
    const attachments = await platform.addOnAttachment.listByAddOn(addon.id)
    credAttachments = attachments.filter(a => a.namespace === `credential:${credName}`)
  }

  const credAttachmentApps = [...new Set(credAttachments.map(a => a.app.name))]
  if (credAttachmentApps.length > 0) {
    throw new Error(`You must detach the credential ${credName} from the app${credAttachmentApps.length > 1 ? 's' : ''} ${credAttachmentApps.join(', ')} before destroying it.`)
  }

  const result = await (isAdvancedTier
    ? data.postgresCredential.delete(addon.id, credName)
    : data.postgresDatabase.deleteCredential(addon.id, credName))

  return {addon, result}
}
