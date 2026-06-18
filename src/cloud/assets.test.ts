import { describe, it, expect } from 'vitest'
import { deriveAssetMeta } from './assets'
import type { SceneObjectDef } from '../types'

function obj(partial: Partial<SceneObjectDef>): SceneObjectDef {
  return {
    id: 'x',
    name: 'obj',
    kind: 'cube',
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
    material: {} as SceneObjectDef['material'],
    ...partial,
  }
}

describe('deriveAssetMeta', () => {
  it('GLB / 画像プレートを storageHash→メタ に変換する', () => {
    const objects = [
      obj({ name: 'tree', kind: 'glb', glbAssetId: 'k1' }),
      obj({ name: 'sign', kind: 'plane', material: { textureAssetId: 'k2' } as SceneObjectDef['material'] }),
    ]
    const assetRefs = { k1: 'assets/aaa', k2: 'assets/bbb' }
    expect(deriveAssetMeta(objects, assetRefs)).toEqual({
      aaa: { name: 'tree', kind: 'glb' },
      bbb: { name: 'sign', kind: 'image' },
    })
  })

  it('assetRefs に無い参照は無視する', () => {
    const objects = [obj({ name: 'ghost', kind: 'glb', glbAssetId: 'missing' })]
    expect(deriveAssetMeta(objects, {})).toEqual({})
  })

  it('同一 storageHash は重複登録しない(最初の名前を保持)', () => {
    const objects = [
      obj({ id: 'a', name: 'first', kind: 'plane', material: { textureAssetId: 'k' } as SceneObjectDef['material'] }),
      obj({ id: 'b', name: 'second', kind: 'plane', material: { textureAssetId: 'k' } as SceneObjectDef['material'] }),
    ]
    const out = deriveAssetMeta(objects, { k: 'assets/same' })
    expect(Object.keys(out)).toEqual(['same'])
    expect(out.same.name).toBe('first')
  })
})
