import {execFileSync, spawnSync} from 'node:child_process'
import {
  cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync,
} from 'node:fs'
import {createRequire} from 'node:module'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {
  afterEach, beforeEach, describe, expect, it,
} from 'vitest'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(HERE, '..')
const SCRIPT_PATH = path.join(REPO_ROOT, 'scripts', 'create-resource.ts')
// Spawn Node directly against each tool's JS entry instead of going through
// the `npx` shim. On Windows, Node 22.x's CVE-2024-27980 mitigation makes
// `spawnSync`/`execFileSync` against `npx.cmd` fail with EINVAL unless
// `shell: true` is set (and shell-true is itself deprecated, DEP0190).
const require = createRequire(import.meta.url)
const TSX_BIN = require.resolve('tsx/cli')
const TSC_BIN = require.resolve('typescript/bin/tsc')

let workDir: string

function stageFixture(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'create-resource-e2e-'))
  // Copy core/ so generated files can resolve `../../../core/extend-resource.js`.
  cpSync(
    path.join(REPO_ROOT, 'src', 'core'),
    path.join(dir, 'src', 'core'),
    {recursive: true},
  )
  cpSync(
    path.join(REPO_ROOT, 'src', 'services'),
    path.join(dir, 'src', 'services'),
    {recursive: true},
  )
  // Symlink node_modules so module resolution works for `@heroku/types`,
  // `@heroku/heroku-fetch`, vitest, and friends inside the temp tree.
  symlinkSync(path.join(REPO_ROOT, 'node_modules'), path.join(dir, 'node_modules'), 'dir')
  // Empty resource trees plus a barrel for each service.
  mkdirSync(path.join(dir, 'src', 'resources', 'extensions'), {recursive: true})
  writeFileSync(path.join(dir, 'src', 'resources', 'extensions', 'platform.ts'), '')
  writeFileSync(path.join(dir, 'src', 'resources', 'extensions', 'data.ts'), '')
  // Stub package.json so `npx eslint` and `tsc` look in REPO_ROOT instead.
  writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}')
  // Minimal tsconfig used for `tsc --noEmit`.
  writeFileSync(
    path.join(dir, 'tsconfig.json'),
    JSON.stringify({
      compilerOptions: {
        esModuleInterop: true,
        lib: ['ES2022', 'DOM'],
        module: 'ES2022',
        moduleResolution: 'bundler',
        noEmit: true,
        skipLibCheck: true,
        strict: true,
        target: 'ES2022',
      },
      exclude: ['node_modules', '**/*.test.ts'],
      include: ['src/**/*.ts'],
    }, null, 2),
  )
  return dir
}

function runScript(args: string[], cwd: string) {
  return spawnSync(process.execPath, [TSX_BIN, SCRIPT_PATH, ...args, '--no-lint'], {
    cwd,
    encoding: 'utf8',
    env: {...process.env, CREATE_RESOURCE_NO_LINT: '1'},
  })
}

beforeEach(() => {
  workDir = stageFixture()
})

afterEach(() => {
  rmSync(workDir, {force: true, recursive: true})
})

describe('create-resource (e2e)', () => {
  it('scaffolds a brand-new resource', () => {
    const r = runScript(
      ['--service', 'platform', '--resource', 'release', '--function', 'describe'],
      workDir,
    )
    expect(r.status, r.stderr).toBe(0)

    const verbPath = path.join(workDir, 'src/resources/platform/release/describe.ts')
    const indexPath = path.join(workDir, 'src/resources/platform/release/index.ts')
    const barrelPath = path.join(workDir, 'src/resources/extensions/platform.ts')

    expect(existsSync(verbPath)).toBe(true)
    expect(existsSync(indexPath)).toBe(true)
    expect(readFileSync(barrelPath, 'utf8')).toContain("export {releaseExtensions} from '../platform/release/index.js'")

    // Resulting tree must type-check.
    execFileSync(process.execPath, [TSC_BIN, '--noEmit', '-p', workDir], {
      cwd: REPO_ROOT,
      stdio: 'inherit',
    })
  })

  it('adds a function to an existing resource', () => {
    const setup = runScript(
      ['--service', 'platform', '--resource', 'release', '--function', 'describe'],
      workDir,
    )
    expect(setup.status, setup.stderr).toBe(0)

    const r = runScript(
      ['--service', 'platform', '--resource', 'release', '--function', 'archive'],
      workDir,
    )
    expect(r.status, r.stderr).toBe(0)

    const indexText = readFileSync(
      path.join(workDir, 'src/resources/platform/release/index.ts'),
      'utf8',
    )
    expect(indexText).toContain('archive:')
    expect(indexText).toContain('describe:')
    expect(indexText.indexOf('archive:')).toBeLessThan(indexText.indexOf('describe:'))

    execFileSync(process.execPath, [TSC_BIN, '--noEmit', '-p', workDir], {
      cwd: REPO_ROOT,
      stdio: 'inherit',
    })
  })

  it('scaffolds multiple functions on a brand-new resource', () => {
    const setup = runScript(
      [
        '--service',
        'platform',
        '--resource',
        'scratchpad',
        '--function',
        'describe',
        '--function',
        'listItems',
      ],
      workDir,
    )
    expect(setup.status, setup.stderr).toBe(0)

    const resourceDir = path.join(workDir, 'src/resources/platform/scratchpad')
    expect(existsSync(path.join(resourceDir, 'describe.ts'))).toBe(true)
    expect(existsSync(path.join(resourceDir, 'describe.test.ts'))).toBe(true)
    expect(existsSync(path.join(resourceDir, 'list-items.ts'))).toBe(true)
    expect(existsSync(path.join(resourceDir, 'list-items.test.ts'))).toBe(true)
    expect(existsSync(path.join(resourceDir, 'index.ts'))).toBe(true)
    expect(existsSync(path.join(resourceDir, 'index.test.ts'))).toBe(true)

    const indexText = readFileSync(path.join(resourceDir, 'index.ts'), 'utf8')
    expect(indexText).toContain('describe:')
    expect(indexText).toContain('listItems:')
    expect(indexText).toContain("from './describe.js'")
    expect(indexText).toContain("from './list-items.js'")

    const indexTestText = readFileSync(path.join(resourceDir, 'index.test.ts'), 'utf8')
    expect(indexTestText).toContain("expect(typeof methods.describe).toBe('function')")
    expect(indexTestText).toContain("expect(typeof methods.listItems).toBe('function')")

    execFileSync(process.execPath, [TSC_BIN, '--noEmit', '-p', workDir], {
      cwd: REPO_ROOT,
      stdio: 'inherit',
    })
  })

  it('refuses to overwrite without --force', () => {
    const setup = runScript(
      ['--service', 'platform', '--resource', 'release', '--function', 'describe'],
      workDir,
    )
    expect(setup.status, setup.stderr).toBe(0)

    const r = runScript(
      ['--service', 'platform', '--resource', 'release', '--function', 'describe'],
      workDir,
    )
    expect(r.status).toBe(1)
    expect(r.stderr).toMatch(/already exist/)
  })
})
