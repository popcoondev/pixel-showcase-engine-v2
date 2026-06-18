import { describe, it, expect } from 'vitest'
import { composeScene, type ComposerAsset } from './composeScene'

const assets: ComposerAsset[] = [
  { hash: 'h1', url: 'data:img,a', kind: 'image', name: 'poster', aspect: 2 },
  { hash: 'h2', url: 'data:glb,b', kind: 'glb', name: 'statue' },
  { hash: 'h3', url: 'data:img,c', kind: 'image', name: 'sign', aspect: 1 },
]

describe('composeScene', () => {
  it('全アセットを配置し、assets テーブルに実体を載せる', () => {
    const f = composeScene(assets)
    expect(f.version).toBe(2)
    expect(f.objects).toHaveLength(3)
    for (const a of assets) {
      expect(f.assets[a.hash]).toBe(a.url)
    }
  })

  it('種別ごとに正しい kind / 参照を作る', () => {
    const f = composeScene(assets)
    const glb = f.objects.find((o) => o.kind === 'glb')!
    expect(glb.glbAssetId).toBe('h2')
    const poster = f.objects.find((o) => o.name === 'poster')!
    expect(poster.kind).toBe('plane')
    expect(poster.material.textureAssetId).toBe('h1')
    // aspect=2 が plane の横幅に反映される
    expect(poster.scale[0]).toBeCloseTo(poster.scale[1] * 2, 5)
  })

  it('三灯ライト + アクティブな Shot を必ず付ける', () => {
    const f = composeScene(assets)
    expect(f.lights).toHaveLength(3)
    expect(f.shots).toHaveLength(1)
    expect(f.activeShotId).toBe(f.shots[0].id)
    // カメラは被写体の前方(+Z)から見ている
    expect(f.shots[0].position[2]).toBeGreaterThan(0)
  })

  it('turntable オプションで GLB に連続回転を付ける', () => {
    const f = composeScene(assets, { turntable: true })
    const glb = f.objects.find((o) => o.kind === 'glb')!
    expect(glb.motion?.enabled).toBe(true)
    expect(glb.motion?.spinY).toBeGreaterThan(0)
  })

  it('turntable オフの GLB は motion キーを持たない(Firestore は undefined を拒否する)', () => {
    const f = composeScene(assets) // turntable 未指定
    const glb = f.objects.find((o) => o.kind === 'glb')!
    expect(Object.prototype.hasOwnProperty.call(glb, 'motion')).toBe(false)
  })

  it('単一アセットは中央に置く', () => {
    const f = composeScene([assets[1]])
    expect(f.objects[0].position[0]).toBe(0)
  })
})
