import { createPlatformClient } from '../src/services/platform.js'

// Create a client — automatically reads token from HEROKU_API_KEY or ~/.netrc
//
// NOTE: If you're getting an "Unauthorized" response, run `heroku login` in your terminal
const heroku = createPlatformClient()

// List all apps
const apps = await heroku.app.list()
console.log(`Found ${apps.length} apps`)

const [lastApp] = apps.slice(-1)

// Get a specific app
const app = await heroku.app.info(lastApp.name!)
console.log(`App: ${app.name} (${app.id})`)
