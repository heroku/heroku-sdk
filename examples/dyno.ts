import {restartDynos, scaleDynos} from '../src/compositions/dyno.js'

const app = process.env.APP!

const formations = await scaleDynos(app, [{quantity: 1, type: 'web'}])
for (const formation of formations) {
  console.log(`scaled ${formation.type} → ${formation.quantity}`)
}

await restartDynos(app, {type: 'web'})
console.log('restarted web dynos')
