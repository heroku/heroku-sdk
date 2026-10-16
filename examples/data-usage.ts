import {createDataClient} from '../src/services/data.js'

// Create a client — zero-arg reads the token from HEROKU_API_KEY
//
// NOTE: For a token stored by `heroku login`, resolve it with
// @heroku/heroku-credential-manager and pass it: createDataClient({token})
const data = createDataClient()

// Look up info for a Heroku Postgres database by attachment name
const dbName = process.argv[2] ?? 'DATABASE'
const info = await data.database.info(dbName)
console.log(`Database ${dbName}:`, info)
