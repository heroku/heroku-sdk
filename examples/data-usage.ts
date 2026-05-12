import {createDataClient} from '../src/services/data.js'

// Create a client — automatically reads token from HEROKU_API_KEY or ~/.netrc
const data = createDataClient()

// Look up info for a Heroku Postgres database by attachment name
const dbName = process.argv[2] ?? 'DATABASE'
const info = await data.database.info(dbName)
console.log(`Database ${dbName}:`, info)
