import {
  backups, credentials, info, maintenance,
} from '../src/compositions/pg.js'

const app = process.env.APP!
const addon = process.env.ADDON

const dbInfo = await info(app, addon)
console.log(`Database (${app}::${addon ?? 'DATABASE_URL'}):`, dbInfo)

const creds = await credentials(app, addon)
console.log('Credentials:', creds)

const maint = await maintenance(app, addon)
console.log('Maintenance:', maint)

// transfers is an array at runtime; @heroku/types ships a permissive shape for it.
const transfers = await backups(app)
console.log('Transfers:', transfers)
