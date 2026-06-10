export type Vec3 = [number, number, number]
export type Vec4 = [number, number, number, number]

export interface MaterialSettings {
  color: string
  metalness: number
  roughness: number
  emissive: string
  emissiveIntensity: number
  pixelated: boolean
  /** assets テーブルのキー。テクスチャ実体は SceneFile.assets に一本化する */
  textureAssetId?: string
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
  /** assets テーブルのキー。同じ GLB を複数置いても実体はひとつ */
  glbAssetId?: string
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

export type EffectKind =
  | 'sparkle'
  | 'mote'
  | 'dust'
  | 'flame'
  | 'splash'
  | 'electric'
  | 'rain'
  | 'wind'

export interface EffectDef {
  id: string
  name: string
  kind: EffectKind
  position: Vec3
  color: string
  /** 粒の数 */
  count: number
  /** 動きの速さ倍率 */
  speed: number
  /** 粒の大きさ倍率 */
  size: number
  /** 広がり半径 (m) */
  radius: number
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
  /** v1: dataURL をオブジェクトに直接埋め込み / v2: assets テーブル参照 */
  version: 1 | 2
  name: string
  /** content hash -> dataURL。GLB / 画像の実体 */
  assets: Record<string, string>
  objects: SceneObjectDef[]
  lights: LightDef[]
  effects: EffectDef[]
  env: EnvSettings
  camera: CameraSettings
  shots: Shot[]
  activeShotId: string | null
}

export type Mode = 'edit' | 'camera' | 'preview'
export type Tab = 'edit' | 'scene' | 'camera' | 'object' | 'light' | 'fx'

export interface Selection {
  type: 'object' | 'light' | 'effect'
  id: string
}
