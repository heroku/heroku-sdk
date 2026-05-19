import type {AddOnAttachment} from '@heroku/types/3.sdk'

import type {PlatformClient} from '../../../services/platform.js'

export async function resolveAddonId(
  platform: PlatformClient,
  appIdentity: string,
  addonIdentity?: string,
): Promise<string> {
  const matches = await platform.addOnAttachment.resolution({
    // eslint-disable-next-line camelcase
    addon_attachment: addonIdentity ?? 'DATABASE_URL',
    app: appIdentity,
  })

  const attachment: AddOnAttachment | undefined = matches[0]
  const addonId = attachment?.addon?.id
  if (!addonId) {
    throw new Error(`Could not resolve add-on for ${appIdentity}${addonIdentity ? `::${addonIdentity}` : ''}`)
  }

  return addonId
}
