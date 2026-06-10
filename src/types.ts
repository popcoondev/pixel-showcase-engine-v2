export type Vec3 = [number, number, number]
export type Vec4 = [number, number, number, number]

export interface MaterialSettings {
  color: string
  metalness: number
  roughness: number
  emissive: string
  emissiveIntensity: number
  pixelated: boolean
  textureDataUrl?: string
}

export type ObjectKind = 'cube' | 'plane' | 'glb'

export interface SceneObjectDef {
  id: string
  name: string
  kind: ObjectKind
  position: Vec3
  rotation: Vec3
  scale: Vec3
  material: MaterialSettings
  /** glb のみ: true のとき material の質感設定で GLB 本来のマテリアルを上書きする */
  materialOverride?: boolean
  glbDataUrl?: string
}

export type LightKind = 'directional' | 'point' | 'spot'

export interface LightDef {
  id: string
  name: string
  kind: LightKind
  color: string
  intensity: number
  position: Vec3
  castShadow: boolean
}

export interface EnvSettings {
  backgroundColor: string
  ambientColor: string
  ambientIntensity: number
  fogEnabled: boolean
  fogColor: string
  fogNear: number
  fogFar: number
  bloomEnabled: boolean
  bloomIntensity: number
  vignetteEnabled: boolean
  vignetteDarkness: number
  gridVisible: boolean
  groundVisible: boolean
  groundColor: string
}

export type FocusMode = 'subject' | 'manual' | 'screenPoint'
export type AspectRatio = '16:9' | '4:3' | '1:1'

export interface CameraSettings {
  /** mm 換算の焦点距離。FOV はここから導出する */
  focalLength: number
  exposure: number
  dofEnabled: boolean
  focusMode: FocusMode
  /** Manual focus の距離 (m) */
  manualFocusDistance: number
  /** F値 */
  aperture: number
  aspect: AspectRatio
}

export interface Shot {
  id: string
  name: string
  position: Vec3
  quaternion: Vec4
  settings: CameraSettings
  focusTarget: Vec3 | null
}

export interface SceneFile {
  version: 1
  name: string
  objects: SceneObjectDef[]
  lights: LightDef[]
  env: EnvSettings
  camera: CameraSettings
  shots: Shot[]
  activeShotId: string | null
}

export type Mode = 'edit' | 'camera' | 'preview'
export type Tab = 'edit' | 'scene' | 'camera' | 'object' | 'light'

export interface Selection {
  type: 'object' | 'light'
  id: string
}
