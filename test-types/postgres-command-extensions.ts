/* eslint-disable no-void */
import {HerokuSDK} from '@heroku/sdk'
import {
  databaseCommandExtensions,
  databaseCopyExtensions,
  legacyDatabaseWaitExtensions,
} from '@heroku/sdk/extensions/data'

const sdk = new HerokuSDK({
  extensions: [databaseCommandExtensions, databaseCopyExtensions, legacyDatabaseWaitExtensions] as const,
})

sdk.data.database.waitForReady('example-app', 'DATABASE_URL', {
  onPoll({addon, status}) {
    const databaseName: string = addon.name
    const waiting: boolean | undefined = status['waiting?']
    void databaseName
    void waiting
  },
})

sdk.data.database.promote('example-app', 'DATABASE_URL', {
  beforePromote({addon, existingAlias}) {
    const databaseName: string = addon.name
    const aliasName: string | undefined = existingAlias?.name
    void databaseName
    void aliasName
  },
})

sdk.data.database.unfollow('example-app', 'DATABASE_URL', {
  beforeUnfollow({following, origin}) {
    const originName: string = origin
    const leaderUrl: string = following
    void originName
    void leaderUrl
  },
})

sdk.data.database.reset('example-app', 'DATABASE_URL', {
  extensions: ['postgis'],
})

sdk.data.database.copy('example-app', 'DATABASE_URL', 'postgres://external.example/db', {
  onCredentialsChecked({credentialCount, hasAdditionalCredentials}) {
    const count: number | undefined = credentialCount
    const shouldWarn: boolean = hasAdditionalCredentials
    void count
    void shouldWarn
  },
})

sdk.data.database.waitForReady('example-app', 'DATABASE_URL', {
  // @ts-expect-error Legacy wait callbacks receive the database and status together.
  onPoll(status: string) {
    void status
  },
})
