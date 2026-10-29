import {describe, expect, it} from 'vitest'

import type {ResourceExtension} from '../../core/extend-resource.js'
import type {FavoriteOptions} from './dashboard-backend.js'

import * as favorite from '../dashboard-backend/favorite/index.js'
import * as barrel from './dashboard-backend.js'

describe('dashboard backend extensions barrel', () => {
  it('re-exports the favorite resource public surface', () => {
    const barrelKeys = new Set(Object.keys(barrel))
    for (const exportName of Object.keys(favorite)) {
      expect(barrelKeys, `barrel is missing ${exportName}`).toContain(exportName)
    }
  })

  it('exports the favorite options type', () => {
    const options: FavoriteOptions = {}
    expect(options).toEqual({})
  })

  it('favoriteExtensions targets the dashboardBackend service', () => {
    expect((barrel.favoriteExtensions as ResourceExtension).service).toBe('dashboardBackend')
  })
})
