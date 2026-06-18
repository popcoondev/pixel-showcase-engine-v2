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

/** Preview / Viewer でオブジェクトを基準位置周りにループさせる動き(各 0 で無効) */
export interface ObjectMotion {
  enabled: boolean
  /** 左右 振幅 m */
  moveX: number
  /** 上下(浮遊)振幅 m */
  moveY: number
  /** 前後 振幅 m */
  moveZ: number
  /** Y軸 連続回転(ターンテーブル)度/秒 */
  spinY: number
  /** 位置オシレーションの周期 秒 */
  speed: number
  /** 揺れのイージング(任意。旧データは linear 相当) */
  easing?: EasingKind
  /** 共有クロック上の位相オフセット 0..1(同周期の別ループと連動させる。任意) */
  phase?: number
}

/** 動きループの揺れ方。linear=純正弦(従来), easeInOut=端で溜める, easeIn/easeOut=片側に溜める */
export type EasingKind = 'linear' | 'easeInOut' | 'easeIn' | 'easeOut'

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
  /** 動きループ(任意。旧データには無いので optional) */
  motion?: ObjectMotion
}

export type LightKind = 'directional' | 'point' | 'spot'

/** 発光ループの種類: pulse=ネオンのように柔らかく明滅 / blink=素早い点滅 / flicker=不規則なちらつき */
export type LightPulseMode = 'pulse' | 'blink' | 'flicker'

export interface LightPulse {
  enabled: boolean
  mode: LightPulseMode
  /** 最小強度の割合(基準強度に対する下限) 0..1 */
  min: number
  /** 速さ(Hz 目安) */
  speed: number
  /** 明滅のイージング(pulse モード時に有効。任意) */
  easing?: EasingKind
  /** 共有クロック上の位相オフセット 0..1(同速の別ライトと交互/連動。任意) */
  phase?: number
}

/** 色サイクルの種類: hue=基準色の色相を揺らす / gradient=複数色を巡回 */
export type LightColorCycleMode = 'hue' | 'gradient'

export interface LightColorCycle {
  enabled: boolean
  mode: LightColorCycleMode
  /** hue: 色相の振れ幅(度 0..180) */
  hueRange: number
  /** gradient: 巡回する色(2〜4色) */
  colors: string[]
  /** 周期 秒 */
  speed: number
  /** 共有クロック上の位相オフセット 0..1(任意) */
  phase?: number
}

export interface LightDef {
  id: string
  name: string
  kind: LightKind
  color: string
  intensity: number
  position: Vec3
  castShadow: boolean
  /** 任意: 発光ループ(明滅/点滅/ちらつき)。未設定なら静止 */
  pulse?: LightPulse
  /** 任意: 色サイクル(色相シフト/多色グラデ)。未設定なら基準色で静止 */
  colorCycle?: LightColorCycle
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

/** Preview / Viewer で被写体周りにループさせるカメラの動き(各振幅 0 で無効) */
export interface CameraMotion {
  enabled: boolean
  /** 左右の弧(オービット)振幅 度 */
  yawDeg: number
  /** 上下の弧 振幅 度 */
  pitchDeg: number
  /** 前後の寄り引き 振幅 (距離に対する割合 0-1) */
  dolly: number
  /** ループ周期 秒 */
  speed: number
  /** カメラワークのイージング(任意。旧データは linear 相当) */
  easing?: EasingKind
  /** 共有クロック上の位相オフセット 0..1(任意) */
  phase?: number
}

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
  /** 動きループ(任意。旧データには無いので optional) */
  motion?: CameraMotion
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
