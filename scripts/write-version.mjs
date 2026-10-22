// Stamps the package.json version into src/version.ts so the SDK can identify
// its own version at runtime (e.g. the default User-Agent) without importing
// package.json, which sits outside the compiler's rootDir. Runs as the `build`
// prebuild step, so the published dist always carries the released version; the
// generated file is also committed so local dev and type-checks resolve the
// import without a build.
import {readFileSync, writeFileSync} from 'node:fs'

const packageJsonUrl = new URL('../package.json', import.meta.url)
const versionFileUrl = new URL('../src/version.ts', import.meta.url)

const {version} = JSON.parse(readFileSync(packageJsonUrl, 'utf8'))

const contents = `// Generated from package.json by scripts/write-version.mjs (build prebuild). Do not edit.
export const SDK_VERSION = '${version}'
`

writeFileSync(versionFileUrl, contents)
