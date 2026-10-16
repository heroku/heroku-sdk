import {createPlatformClient} from '../src/services/platform.js'

// Create a client — zero-arg reads the token from HEROKU_API_KEY
//
// NOTE: For a token stored by `heroku login`, resolve it with
// @heroku/heroku-credential-manager and pass it: createPlatformClient({token})
const heroku = createPlatformClient()

// List all apps
const apps = await heroku.app.list()
console.log(`Found ${apps.length} apps`)

const [lastApp] = apps.slice(-1)

// Get a specific app
const app = await heroku.app.info(lastApp.name!)
console.log(`App: ${app.name} (${app.id})`)
