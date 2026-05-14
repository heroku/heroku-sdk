import {createDataClient} from '../src/services/data.js'

// Create a client — automatically reads token from HEROKU_API_KEY or ~/.netrc
//
// NOTE: If you're getting an "Unauthorized" response, run `heroku login` in your terminal
const data = createDataClient()

// Look up info for a Heroku Postgres database by attachment name
const dbName = process.argv[2] ?? 'DATABASE'
const info = await data.database.info(dbName)
console.log(`Database ${dbName}:`, info)
