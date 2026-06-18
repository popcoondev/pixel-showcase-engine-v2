import { describe, it, expect } from 'vitest'
import {
  aspectToNumber,
  focalToFov,
  fovToFocal,
  hashDataUrl,
  migrateSceneFile,
  useStore,
} from './store'
import type { CameraSettings, EnvSettings, SceneFile } from './types'

const camera: CameraSettings = {
  focalLength: 35,
  exposure: 1,
  dofEnabled: false,
  focusMode: 'subject',
  manualFocusDistance: 10,
  aperture: 2.8,
  aspect: '16:9',
}

function v1Scene(partial: Partial<SceneFile> & { env?: Partial<EnvSettings> } = {}): SceneFile {
  // v1 形式: assets テーブルが無く、dataURL を object に直接埋め込む
  return {
    version: 1,
    name: 'legacy',
    objects: [],
    lights: [],
    env: {} as EnvSettings,
    camera,
    shots: [],
    activeShotId: null,
    ...partial,
  } as unknown as SceneFile
}

describe('focalToFov / fovToFocal', () => {
  it('互いに逆関数になっている', () => {
    for (const mm of [12, 24, 35, 50, 85, 200]) {
      expect(fovToFocal(focalToFov(mm))).toBeCloseTo(mm, 4)
    }
  })
  it('焦点距離が長いほど画角は狭い', () => {
    expect(focalToFov(24)).toBeGreaterThan(focalToFov(85))
  })
})

describe('aspectToNumber', () => {
  it('各フレーム比を数値化する', () => {
    expect(aspectToNumber('16:9')).toBeCloseTo(16 / 9)
    expect(aspectToNumber('4:3')).toBeCloseTo(4 / 3)
    expect(aspectToNumber('1:1')).toBe(1)
  })
})

describe('hashDataUrl', () => {
  it('同じ入力は同じ id (決定的・12byte=24hex)', async () => {
    const a = await hashDataUrl('data:image/png;base64,AAAA')
    const b = await hashDataUrl('data:image/png;base64,AAAA')
    expect(a).toBe(b)
    expect(a).toMatch(/^[0-9a-f]{24}$/)
  })
  it('異なる入力は異なる id', async () => {
    const a = await hashDataUrl('data:image/png;base64,AAAA')
    const b = await hashDataUrl('data:image/png;base64,BBBB')
    expect(a).not.toBe(b)
  })
})

describe('migrateSceneFile (v1 -> v2)', () => {
  it('glbDataUrl / textureDataUrl を assets テーブルに移し参照IDに置換する', () => {
    const file = v1Scene({
      objects: [
        {
          id: 'o1',
          name: 'box',
          kind: 'glb',
          position: [0, 0, 0],
          rotation: [0, 0, 0],
          scale: [1, 1, 1],
          material: { textureDataUrl: 'data:tex,AAA' },
          glbDataUrl: 'data:glb,BBB',
        },
      ],
    } as unknown as Partial<SceneFile>)

    const out = migrateSceneFile(file)
    expect(out.version).toBe(2)
    const obj = out.objects[0]
    expect(obj.glbAssetId).toBeTruthy()
    expect(obj.material.textureAssetId).toBeTruthy()
    // 実体は assets に入り、object からは dataURL が消える
    expect(out.assets[obj.glbAssetId!]).toBe('data:glb,BBB')
    expect(out.assets[obj.material.textureAssetId!]).toBe('data:tex,AAA')
    expect((obj as Record<string, unknown>).glbDataUrl).toBeUndefined()
  })

  it('同一 dataURL は重複排除されて1つの asset になる', () => {
    const shared = 'data:tex,SAME'
    const mk = (id: string) => ({
      id,
      name: id,
      kind: 'plane',
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
      material: { textureDataUrl: shared },
    })
    const out = migrateSceneFile(
      v1Scene({ objects: [mk('a'), mk('b')] } as unknown as Partial<SceneFile>),
    )
    expect(Object.keys(out.assets)).toHaveLength(1)
    expect(out.objects[0].material.textureAssetId).toBe(out.objects[1].material.textureAssetId)
  })

  it('v2 ファイルはそのまま通す', () => {
    const v2: SceneFile = {
      version: 2,
      name: 'v2',
      assets: { x: 'data:a,1' },
      objects: [],
      lights: [],
      env: {} as EnvSettings,
      camera,
      shots: [],
      activeShotId: null,
    }
    expect(migrateSceneFile(v2)).toBe(v2)
  })
})

describe('loadScene / serialize 往復', () => {
  it('v2 シーンを読み込んで serialize すると主要フィールドが保たれる', () => {
    const scene: SceneFile = {
      version: 2,
      name: 'round-trip',
      assets: { h1: 'data:glb,XYZ' },
      objects: [
        {
          id: 'g1',
          name: 'model',
          kind: 'glb',
          position: [1, 2, 3],
          rotation: [0, 0, 0],
          scale: [1, 1, 1],
          material: {
            color: '#ffffff',
            metalness: 0,
            roughness: 1,
            emissive: '#000000',
            emissiveIntensity: 0,
            pixelated: true,
          },
          glbAssetId: 'h1',
        },
      ],
      lights: [],
      env: {} as EnvSettings,
      camera,
      shots: [],
      activeShotId: null,
    }
    useStore.getState().loadScene(scene)
    const out = useStore.getState().serialize()
    expect(out.version).toBe(2)
    expect(out.name).toBe('round-trip')
    expect(out.assets).toEqual({ h1: 'data:glb,XYZ' })
    expect(out.objects[0].glbAssetId).toBe('h1')
    expect(out.objects[0].position).toEqual([1, 2, 3])
  })

  it('動きループ系(motion/pulse/colorCycle/easing/phase)が公開シーンの往復で保たれる', () => {
    const scene: SceneFile = {
      version: 2,
      name: 'loops',
      assets: {},
      objects: [
        {
          id: 'o1',
          name: 'm',
          kind: 'cube',
          position: [0, 0, 0],
          rotation: [0, 0, 0],
          scale: [1, 1, 1],
          material: {
            color: '#ffffff',
            metalness: 0,
            roughness: 1,
            emissive: '#000000',
            emissiveIntensity: 0,
            pixelated: true,
          },
          motion: { enabled: true, moveX: 0, moveY: 0.4, moveZ: 0, spinY: 30, speed: 6, easing: 'easeInOut', phase: 0.25 },
        },
      ],
      lights: [
        {
          id: 'l1',
          name: 'key',
          kind: 'point',
          color: '#ff00ff',
          intensity: 50,
          position: [0, 3, 0],
          castShadow: false,
          pulse: { enabled: true, mode: 'pulse', min: 0.2, speed: 1, easing: 'easeOut', phase: 0.5 },
          colorCycle: { enabled: true, mode: 'gradient', hueRange: 60, colors: ['#ff00ff', '#00ffff', '#ffff00'], speed: 4, phase: 0.5 },
        },
      ],
      env: {} as EnvSettings,
      camera: { ...camera, motion: { enabled: true, yawDeg: 18, pitchDeg: 4, dolly: 0.1, speed: 11, easing: 'easeInOut', phase: 0.5 } },
      shots: [],
      activeShotId: null,
    }
    useStore.getState().loadScene(scene)
    const out = useStore.getState().serialize()
    expect(out.objects[0].motion).toEqual(scene.objects[0].motion)
    expect(out.lights[0].pulse).toEqual(scene.lights[0].pulse)
    expect(out.lights[0].colorCycle).toEqual(scene.lights[0].colorCycle)
    expect(out.camera.motion).toEqual(scene.camera.motion)
  })

  it('旧 env トグル (sparkleEnabled) は effects に移行される', () => {
    const legacy = v1Scene({
      env: { sparkleEnabled: true } as unknown as EnvSettings,
    })
    useStore.getState().loadScene(legacy)
    const effects = useStore.getState().effects
    expect(effects.some((e) => e.kind === 'sparkle')).toBe(true)
  })
})
