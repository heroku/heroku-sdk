import {listDynos, restartDynos, scaleDynos} from '../src/compositions/dyno.js'

const app = process.env.APP!

const dynos = await listDynos(app)
console.log(`${dynos.length} dyno(s) on ${app}:`)
for (const dyno of dynos) {
  console.log(`  ${dyno.name} (${dyno.state})`)
}

const formations = await scaleDynos(app, [{quantity: 1, type: 'web'}])
for (const formation of formations) {
  console.log(`scaled ${formation.type} → ${formation.quantity}`)
}

await restartDynos(app, {type: 'web'})
console.log('restarted web dynos')
