import type { CameraSettings, EnvSettings, LightDef } from './types'

/** 見せ方(背景・霧・発光・ライトリグ)のプリセット。applyHd2dLook の一般化。 */
export interface LookPreset {
  id: string
  name: string
  /** setEnv でマージ適用する背景/霧/ブルーム/周辺減光など */
  env: Partial<EnvSettings>
  /** ライトリグ。適用時に既存ライトを置き換える(id は適用時に採番) */
  lights: Omit<LightDef, 'id'>[]
  /** 露出など任意のカメラ調整 */
  camera?: Partial<CameraSettings>
}

export const LOOK_PRESETS: LookPreset[] = [
  {
    id: 'night-altar',
    name: '夜の祭壇',
    env: {
      backgroundColor: '#0a0c14',
      ambientColor: '#5b6fae',
      ambientIntensity: 0.3,
      fogEnabled: true,
      fogColor: '#0e1430',
      fogNear: 10,
      fogFar: 46,
      bloomEnabled: true,
      bloomIntensity: 1.5,
      vignetteEnabled: true,
      vignetteDarkness: 0.85,
      groundColor: '#12141d',
    },
    lights: [
      { name: 'Key', kind: 'directional', color: '#ffd9a0', intensity: 3.0, position: [3, 9, 2], castShadow: true },
      { name: 'Rim', kind: 'directional', color: '#6e8cff', intensity: 1.0, position: [-5, 3, -4], castShadow: false },
    ],
    camera: { exposure: 1.1 },
  },
  {
    id: 'morning-window',
    name: '朝の窓辺',
    env: {
      backgroundColor: '#dfe6ee',
      ambientColor: '#cfe0ff',
      ambientIntensity: 0.7,
      fogEnabled: true,
      fogColor: '#e6ecf4',
      fogNear: 22,
      fogFar: 80,
      bloomEnabled: true,
      bloomIntensity: 0.6,
      vignetteEnabled: true,
      vignetteDarkness: 0.3,
      groundColor: '#c9d2de',
    },
    lights: [
      { name: 'Sun', kind: 'directional', color: '#fff2d8', intensity: 3.6, position: [6, 7, 5], castShadow: true },
      { name: 'Sky Fill', kind: 'directional', color: '#bcd2ff', intensity: 0.8, position: [-3, 5, -2], castShadow: false },
    ],
    camera: { exposure: 1.15 },
  },
  {
    id: 'monochrome-gallery',
    name: 'モノクロ展示',
    env: {
      backgroundColor: '#1a1a1c',
      ambientColor: '#cfcfd3',
      ambientIntensity: 0.6,
      fogEnabled: false,
      bloomEnabled: true,
      bloomIntensity: 0.4,
      vignetteEnabled: true,
      vignetteDarkness: 0.5,
      groundColor: '#242427',
    },
    lights: [
      { name: 'Front', kind: 'directional', color: '#ffffff', intensity: 2.6, position: [2, 6, 6], castShadow: true },
      { name: 'Back', kind: 'directional', color: '#ffffff', intensity: 1.4, position: [-2, 5, -5], castShadow: false },
    ],
    camera: { exposure: 1.0 },
  },
  {
    id: 'dusk',
    name: '夕暮れ',
    env: {
      backgroundColor: '#2a1730',
      ambientColor: '#a06ba0',
      ambientIntensity: 0.45,
      fogEnabled: true,
      fogColor: '#3a1f3e',
      fogNear: 14,
      fogFar: 55,
      bloomEnabled: true,
      bloomIntensity: 1.2,
      vignetteEnabled: true,
      vignetteDarkness: 0.7,
      groundColor: '#241522',
    },
    lights: [
      { name: 'Sunset', kind: 'directional', color: '#ff9a55', intensity: 3.2, position: [8, 3, 3], castShadow: true },
      { name: 'Sky', kind: 'directional', color: '#7e6cff', intensity: 0.9, position: [-4, 6, -3], castShadow: false },
    ],
    camera: { exposure: 1.1 },
  },
]
