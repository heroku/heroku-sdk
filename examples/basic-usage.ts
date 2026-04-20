import { createHerokuClient } from '../src/index.js'

// Create a client — automatically reads token from HEROKU_API_KEY or ~/.netrc
const heroku = createHerokuClient()

// List all apps
const apps = await heroku.app.list()
console.log(`Found ${apps.length} apps`)

// Get a specific app
const app = await heroku.app.info('my-app')
console.log(`App: ${app.name} (${app.id})`)

// Create an app
const newApp = await heroku.app.create({ name: 'my-new-app' })
console.log(`Created: ${newApp.name}`)

// Update an account feature
const feature = await heroku.accountFeature.update('my-feature', { enabled: true })
console.log(`Feature ${feature.name} enabled: ${feature.enabled}`)
