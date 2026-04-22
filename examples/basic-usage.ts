import { createHerokuClient } from '../src/index.js'

// Create a client — automatically reads token from HEROKU_API_KEY or ~/.netrc
const heroku = createHerokuClient()

// List all apps
const apps = await heroku.app.list()
console.log(`Found ${apps.length} apps`)

const [lastApp] = apps.slice(-1);

// Get a specific app
const app = await heroku.app.info(lastApp.name!)
console.log(`App: ${app.name} (${app.id})`)
