import {readdir} from 'node:fs/promises'
import {dirname, join} from 'node:path'
import {fileURLToPath} from 'node:url'
import {describe, expect, it} from 'vitest'

import type {ResourceExtension} from '../../core/extend-resource.js'

import * as barrel from './platform.js'

const currentFile = fileURLToPath(import.meta.url)
const currentDir = dirname(currentFile)
const PLATFORM_DIR = join(currentDir, '..', 'platform')

async function findExtensionExports(): Promise<Map<string, ResourceExtension>> {
  const entries = await readdir(PLATFORM_DIR, {withFileTypes: true})
  const sourceFiles = entries
    .filter(entry => entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts'))
    .map(entry => entry.name)

  const exports = new Map<string, ResourceExtension>()
  for (const file of sourceFiles) {
    // eslint-disable-next-line no-await-in-loop
    const mod = await import(join(PLATFORM_DIR, file))
    for (const [exportName, value] of Object.entries(mod)) {
      if (exportName.endsWith('Extensions') && isResourceExtension(value)) {
        exports.set(exportName, value)
      }
    }
  }

  return exports
}

function isResourceExtension(value: unknown): value is ResourceExtension {
  return Boolean(value
    && typeof value === 'object'
    && 'service' in value
    && 'resource' in value
    && 'factory' in value)
}

describe('platform extensions barrel', () => {
  it('re-exports every *Extensions value found in src/resources/platform/*.ts', async () => {
    const sourceExports = await findExtensionExports()
    expect(sourceExports.size).toBeGreaterThan(0)

    const barrelKeys = new Set(Object.keys(barrel))
    for (const exportName of sourceExports.keys()) {
      expect(barrelKeys, `barrel is missing ${exportName}`).toContain(exportName)
    }
  })

  it('every *Extensions in the barrel targets the platform service', () => {
    for (const [name, value] of Object.entries(barrel)) {
      if (!name.endsWith('Extensions')) continue
      expect((value as ResourceExtension).service, `${name} should target platform`).toBe('platform')
    }
  })
})
