import {PostgresCredentialInfoResult as AdvancedCredentialInfo} from '@heroku/types/data'

import type {ResourceCtx} from '../../../core/extend-resource.js'
import type {ResolvedAddOn} from '../../platform/add-on/types.js'
import type {DatabaseCredentialOptions} from './index.js'

import {withSignal} from '../../../core/with-signal.js'
import {resolveAddonInternal} from '../../platform/add-on/resolve.js'
import {
  getPostgresServiceName, isAdvancedCredential, isAdvancedDatabase, isEssentialTier,
} from '../internal/postgres-utils.js'
import {CredentialInfo as NonAdvancedCredentialInfo} from '../postgres-database.js'

export type CredentialConnectionInfo = {
  credName: string
  database: string
  host: string
  password: string
  port: number
  url: string
  user: string
}

export type GetDatabaseCredentialUrlResult = {
  addon: ResolvedAddOn
  credentialConnectionInfo: CredentialConnectionInfo
}

/**
 * Looks up the active connection info for a Postgres database credential,
 * dispatching to the Advanced-tier or classic-tier endpoint based on the
 * resolved add-on's plan, and returns a ready-to-use connection URL.
 *
 * `credName` defaults to the owner credential on the Advanced tier, or the
 * `default` credential on the classic tier.
 */
export async function getUrl(
  ctx: Pick<ResourceCtx, 'data' | 'platform'>,
  addonIdentity: string,
  credName?: string,
  options: DatabaseCredentialOptions = {},
): Promise<GetDatabaseCredentialUrlResult> {
  options.signal?.throwIfAborted()
  // Bind the signal so the resolve and lookup requests abort in flight.
  const platform = withSignal(ctx.platform, options.signal)
  const addon = await resolveAddonInternal(platform, addonIdentity, {
    addonService: getPostgresServiceName(), appIdentity: options.appIdentity,
  })
  const data = withSignal(ctx.data, options.signal)

  if (isEssentialTier(addon) && credName && credName !== 'default') {
    throw new Error('Essential-tier databases don\'t support named credentials.')
  }

  let name: string | undefined
  let info: AdvancedCredentialInfo | NonAdvancedCredentialInfo

  if (isAdvancedDatabase(addon)) {
    name = credName

    if (!name) {
      const {items} = await data.postgresCredential.list(addon.id)
      name = items.find(item => item.type === 'owner')?.name

      if (!name) {
        throw new Error(`There are no active credentials on the database ${addon.name}.`)
      }
    }

    info = await data.postgresCredential.info(addon.id, name)
  } else {
    name = credName || 'default'
    info = await data.postgresDatabase.infoCredential(addon.id, name)
  }

  const activeCred = isAdvancedCredential(info)
    ? info.roles.find(r => r.state === 'active')
    : info.credentials.find(c => c.state === 'active')

  if (!activeCred) {
    throw new Error(`The credential ${name} isn't active on the database ${addon.name}.`)
  }

  const credInfo = {
    credName: name,
    database: info.database,
    host: info.host,
    password: activeCred.password,
    port: info.port,
    user: activeCred.user,
  }

  const url = new URL(`postgres://${credInfo.host}/${credInfo.database}`)
  url.port = credInfo.port.toString()

  if (credInfo.user && credInfo.password) {
    url.username = credInfo.user
    url.password = credInfo.password
  }

  const credentialConnectionInfo = {
    ...credInfo,
    url: url.toString(),
  }

  return {
    addon,
    credentialConnectionInfo,
  }
}
