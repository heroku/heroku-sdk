import {
  describePgDatabase,
  describePgMaintenance,
  listPgCredentials,
  listPgTransfers,
} from '../src/compositions/pg.js'

const app = process.env.APP!
const addon = process.env.ADDON

const dbInfo = await describePgDatabase(app, addon)
console.log(`Database (${app}::${addon ?? 'DATABASE_URL'}):`, dbInfo)

const creds = await listPgCredentials(app, addon)
console.log('Credentials:', creds)

const maint = await describePgMaintenance(app, addon)
console.log('Maintenance:', maint)

// transfers is an array at runtime; @heroku/types ships a permissive shape for it.
const transfers = await listPgTransfers(app)
console.log('Transfers:', transfers)
