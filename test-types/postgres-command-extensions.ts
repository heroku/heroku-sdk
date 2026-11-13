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

sdk.data.database.waitForReadyForApp('example-app', 'DATABASE_URL', {
  onPoll({addon, status}) {
    const databaseName: string = addon.name
    const waiting: boolean | undefined = status['waiting?']
    void databaseName
    void waiting
  },
})

sdk.data.database.promoteForApp('example-app', 'DATABASE_URL', {
  beforePromote({addon, existingAlias}) {
    const databaseName: string = addon.name
    const aliasName: string | undefined = existingAlias?.name
    void databaseName
    void aliasName
  },
})

// Generated `reset`/`unfollow` names stay reserved for their routes; app-scoped
// composites use `ForApp` because they resolve the raw app/database identity.
sdk.data.database.unfollowForApp('example-app', 'DATABASE_URL', {
  beforeUnfollow({following, origin}) {
    const originName: string = origin.type === 'config_var' ? origin.name : origin.hostname
    if (origin.type === 'config_var') {
      const {rawName}: {rawName: string} = origin
      const displayName: string = origin.name
      void rawName
      void displayName
    } else {
      const {defaultPort, port}: {defaultPort: string; port: string} = origin
      void port
      void defaultPort
    }

    const leaderUrl: string = following
    void originName
    void leaderUrl
  },
})

sdk.data.database.unfollowForApp('example-app', 'DATABASE_URL', {
  beforeUnfollow({origin}) {
    if (origin.type === 'url') {
      const explicitPort: string = origin.port
      void explicitPort
    }
  },
})

sdk.data.database.resetForApp('example-app', 'DATABASE_URL', {
  extensions: ['postgis'],
})

// Generated database route methods retain their direct add-on-id signatures.
sdk.data.database.unfollow('database-id')
sdk.data.database.reset('database-id', {extensions: ['postgis']})

// @ts-expect-error The generated unfollow route accepts a database ID, not app/database inputs.
sdk.data.database.unfollow('example-app', 'DATABASE_URL')
// @ts-expect-error The generated reset route accepts a database ID, not app/database inputs.
sdk.data.database.reset('example-app', 'DATABASE_URL')

const copyResult = await sdk.data.database.copyForApp('example-app', 'DATABASE_URL', 'postgres://external.example/db', {
  onCredentialsChecked({credentialCount, hasAdditionalCredentials}) {
    const count: number | undefined = credentialCount
    const shouldWarn: boolean = hasAdditionalCredentials
    void count
    void shouldWarn
  },
})
const copyWarnings: string[] = copyResult.warnings
void copyWarnings

sdk.data.database.promoteForApp('example-app', 'DATABASE_URL', {
  onProgress(event) {
    const eventType: string = event.type
    void eventType
  },
})

sdk.data.database.waitForReadyForApp('example-app', 'DATABASE_URL', {
  // @ts-expect-error Legacy wait callbacks receive the database and status together.
  onPoll(status: string) {
    void status
  },
})

// Composite commands use explicit app-scoped names; former aliases are absent.
// @ts-expect-error The former promote extension alias was removed.
sdk.data.database.promote('example-app', 'DATABASE_URL')
// @ts-expect-error The former copy extension alias was removed.
sdk.data.database.copy('example-app', 'DATABASE_URL', 'postgres://external.example/db')
// @ts-expect-error The former waitForReady extension alias was removed.
sdk.data.database.waitForReady('example-app', 'DATABASE_URL')
