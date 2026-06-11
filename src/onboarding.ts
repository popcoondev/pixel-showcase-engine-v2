import { useStore } from './store'
import type { CameraSettings, EnvSettings, LightDef, SceneFile, SceneObjectDef } from './types'

const ONBOARD_KEY = 'pse:onboarded'

export function isFirstRun(): boolean {
  try {
    return !localStorage.getItem(ONBOARD_KEY)
  } catch {
    return false
  }
}

export function markOnboarded() {
  try {
    localStorage.setItem(ONBOARD_KEY, '1')
  } catch {
    /* localStorage 不可でも続行 */
  }
}

// ドット絵のマッシュルーム (透明 '.' + パレット). アセット同梱を避け手続き生成する。
const SPRITE = [
  '.....DDD.....',
  '...DDRRRDD...',
  '..DRRWRRWRD..',
  '.DRRRRRRRRRD.',
  '.DRWRRRRRWRD.',
  '.DRRRRRRRRRD.',
  '..DDDSSSDDD..',
  '....DSSSD....',
  '....DSSSD....',
  '....DSSSD....',
  '...DSSSSSD...',
  '....DDDDD....',
]
const PALETTE: Record<string, string> = {
  D: '#2a1a2a',
  R: '#e2574f',
  W: '#ffffff',
  S: '#e8d8b0',
}

/** ブラウザでのみ呼ぶ。ドット絵スプライトを dataURL で返す。 */
function makePixelSpriteDataUrl(): string {
  const w = SPRITE[0].length
  const h = SPRITE.length
  const cv = document.createElement('canvas')
  cv.width = w
  cv.height = h
  const ctx = cv.getContext('2d')!
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const c = PALETTE[SPRITE[y][x]]
      if (!c) continue
      ctx.fillStyle = c
      ctx.fillRect(x, y, 1, 1)
    }
  }
  return cv.toDataURL('image/png')
}

const camera: CameraSettings = {
  focalLength: 50,
  exposure: 1.1,
  dofEnabled: true,
  focusMode: 'subject',
  manualFocusDistance: 6,
  aperture: 2.8,
  aspect: '16:9',
}

const env: EnvSettings = {
  backgroundColor: '#0c0f1a',
  ambientColor: '#7c8ec4',
  ambientIntensity: 0.4,
  fogEnabled: true,
  fogColor: '#141c33',
  fogNear: 14,
  fogFar: 55,
  bloomEnabled: true,
  bloomIntensity: 1.0,
  vignetteEnabled: true,
  vignetteDarkness: 0.7,
  gridVisible: true,
  groundVisible: true,
  groundColor: '#171b26',
}

/**
 * 初回起動時のサンプルシーンを store に流し込む。
 * ドット絵プレート + キューブ + 発光体 + 暖色/寒色ライト + キラキラ。
 * ブラウザ専用(canvas 使用)。loadScene の flash を避けるため setState で直接置く。
 */
export function buildSampleScene() {
  const plateTex = makePixelSpriteDataUrl()
  const objects: SceneObjectDef[] = [
    {
      id: 'sample-plate',
      name: 'ドット絵プレート',
      kind: 'plane',
      position: [0, 1.1, 0],
      rotation: [0, 0, 0],
      scale: [2.2, 2, 1],
      material: {
        color: '#ffffff',
        metalness: 0,
        roughness: 1,
        emissive: '#000000',
        emissiveIntensity: 0,
        pixelated: true,
        textureAssetId: 'sample-sprite',
      },
    },
    {
      id: 'sample-cube',
      name: 'Cube',
      kind: 'cube',
      position: [-1.7, 0.5, 0.7],
      rotation: [0, 0.4, 0],
      scale: [1, 1, 1],
      material: {
        color: '#9aa4b8',
        metalness: 0.1,
        roughness: 0.7,
        emissive: '#000000',
        emissiveIntensity: 0,
        pixelated: true,
      },
    },
    {
      id: 'sample-lantern',
      name: 'Lantern',
      kind: 'cube',
      position: [1.6, 0.4, 0.9],
      rotation: [0, 0.6, 0],
      scale: [0.5, 0.5, 0.5],
      material: {
        color: '#5a3a10',
        metalness: 0.1,
        roughness: 0.5,
        emissive: '#ffaa33',
        emissiveIntensity: 4,
        pixelated: true,
      },
    },
  ]
  const lights: LightDef[] = [
    {
      id: 'sample-key',
      name: 'Key Light',
      kind: 'directional',
      color: '#ffd9a8',
      intensity: 3.2,
      position: [5, 8, 4],
      castShadow: true,
    },
    {
      id: 'sample-fill',
      name: 'Fill Light',
      kind: 'directional',
      color: '#8fb0ff',
      intensity: 0.6,
      position: [-4, 3, -3],
      castShadow: false,
    },
  ]
  const file: SceneFile = {
    version: 2,
    name: 'welcome-sample',
    assets: { 'sample-sprite': plateTex },
    objects,
    lights,
    effects: [
      {
        id: 'sample-sparkle',
        name: 'キラキラの霧',
        kind: 'sparkle',
        position: [0, 2.5, 0],
        color: '#cfe4ff',
        count: 200,
        speed: 1,
        size: 1,
        radius: 8,
      },
    ],
    env,
    camera,
    shots: [],
    activeShotId: null,
  }

  useStore.setState({
    sceneName: file.name,
    assets: file.assets,
    objects: file.objects,
    lights: file.lights,
    effects: file.effects,
    env: file.env,
    camera: file.camera,
    shots: [],
    activeShotId: null,
    selected: null,
    mode: 'edit',
    tab: 'edit',
    focusTarget: null,
  })
}
