import {upgradePrepare, upgradeRun} from '../src/compositions/pg.js'

// DESTRUCTIVE: runs an actual Postgres version upgrade.
// Set CONFIRM=<app-name> to proceed.
const app = process.env.APP!
const addon = process.env.ADDON
const version = process.env.PG_VERSION
const mode = process.env.MODE ?? 'run'

if (process.env.CONFIRM !== app) {
  throw new Error(`Set CONFIRM=${app} to proceed (this performs an actual upgrade).`)
}

if (mode === 'prepare') {
  const result = await upgradePrepare(app, addon, version ? {version} : {})
  console.log('upgradePrepare:', result)
} else {
  const result = await upgradeRun(app, addon, version ? {version} : {})
  console.log('upgradeRun:', result)
}
