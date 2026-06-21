import { create } from 'zustand'
import type * as THREE from 'three'
import { loadShow } from './db'
import { LOOK_PRESETS } from './presets'
import type {
  AspectRatio,
  CameraMotion,
  CameraSettings,
  EffectDef,
  EffectKind,
  EnvSettings,
  LightColorCycle,
  LightDef,
  LightKind,
  LightPulse,
  MaterialSettings,
  Mode,
  SceneFile,
  SceneObjectDef,
  SceneRoot,
  TourSettings,
  Selection,
  Shot,
  Tab,
  Vec3,
} from './types'

/** React の外で共有する three.js ランタイム参照 */
export const runtime = {
  camera: null as THREE.PerspectiveCamera | null,
  canvas: null as HTMLCanvasElement | null,
  /** id -> シーン内の Object3D(選択ギズモのターゲット解決用) */
  objects: new Map<string, THREE.Object3D>(),
  /** TransformControls 実体。axis が non-null ならギズモにホバー中 */
  gizmo: null as { axis: string | null } | null,
  /** 左ドラッグで視点を回した直後に onPointerMissed の選択解除を抑止する */
  suppressMissed: false,
}

/** addGlb 直後の GLB id。ロード後に bounding box でスケール自動正規化する対象(TASK-042)。 */
const pendingGlbNormalize = new Set<string>()
/** GLB の正規化後の最大寸法(m)。インポートしたモデルをこの大きさに揃える。 */
const GLB_TARGET_SIZE = 1.6

export const SENSOR_HALF_HEIGHT = 12 // 35mm フルフレーム縦 24mm の半分

export function focalToFov(mm: number): number {
  return (2 * Math.atan(SENSOR_HALF_HEIGHT / mm) * 180) / Math.PI
}

export function fovToFocal(deg: number): number {
  return SENSOR_HALF_HEIGHT / Math.tan(((deg / 2) * Math.PI) / 180)
}

export function aspectToNumber(a: AspectRatio): number {
  if (a === '16:9') return 16 / 9
  if (a === '4:3') return 4 / 3
  return 1
}

const newId = () => crypto.randomUUID().slice(0, 8)

/** dataURL の内容ハッシュ。同じファイルを何度読み込んでも同じ asset id になる */
export async function hashDataUrl(dataUrl: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(dataUrl))
  return Array.from(new Uint8Array(digest).slice(0, 12))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

/** v1 (dataURL 直接埋め込み) の SceneFile を v2 (assets テーブル) に変換する */
export function migrateSceneFile(file: SceneFile): SceneFile {
  if (file.version === 2 && file.assets) return file
  type LegacyObject = SceneObjectDef & {
    glbDataUrl?: string
    material: MaterialSettings & { textureDataUrl?: string }
  }
  const assets: Record<string, string> = {}
  let n = 0
  const intern = (dataUrl: string): string => {
    for (const [k, v] of Object.entries(assets)) if (v === dataUrl) return k
    const id = `legacy-${++n}`
    assets[id] = dataUrl
    return id
  }
  const objects = (file.objects as LegacyObject[]).map((o) => {
    const { glbDataUrl, ...rest } = o
    const { textureDataUrl, ...material } = o.material
    return {
      ...rest,
      material: {
        ...material,
        textureAssetId: textureDataUrl ? intern(textureDataUrl) : material.textureAssetId,
      },
      glbAssetId: glbDataUrl ? intern(glbDataUrl) : o.glbAssetId,
    }
  })
  return { ...file, version: 2, assets, objects }
}

const defaultMaterial = (): MaterialSettings => ({
  color: '#9aa4b8',
  metalness: 0.1,
  roughness: 0.7,
  emissive: '#000000',
  emissiveIntensity: 0,
  pixelated: true,
})

const defaultEnv = (): EnvSettings => ({
  backgroundColor: '#101218',
  ambientColor: '#8fa3c8',
  ambientIntensity: 0.5,
  fogEnabled: true,
  fogColor: '#101218',
  fogNear: 18,
  fogFar: 70,
  bloomEnabled: true,
  bloomIntensity: 0.6,
  vignetteEnabled: true,
  vignetteDarkness: 0.55,
  gridVisible: true,
  groundVisible: true,
  groundColor: '#1c2026',
})

export const EFFECT_LABELS: Record<EffectKind, string> = {
  sparkle: 'キラキラの霧',
  mote: '光の粒',
  dust: 'ダスト',
  flame: '炎',
  splash: '飛沫',
  electric: '電気',
  rain: '雨',
  wind: '風',
}

const EFFECT_DEFAULTS: Record<EffectKind, Omit<EffectDef, 'id' | 'name' | 'kind'>> = {
  sparkle: { position: [0, 2.5, 0], color: '#cfe4ff', count: 260, speed: 1, size: 1, radius: 14 },
  mote: { position: [0, 2, 0], color: '#ffd9a0', count: 48, speed: 1, size: 1, radius: 12 },
  dust: { position: [0, 3, 0], color: '#d8d4c8', count: 320, speed: 1, size: 1, radius: 12 },
  flame: { position: [0, 0.2, 0], color: '#ff9a3c', count: 120, speed: 1, size: 1, radius: 0.35 },
  splash: { position: [0, 0.3, 0], color: '#bfe8ff', count: 160, speed: 1, size: 1, radius: 0.25 },
  electric: { position: [0, 1, 0], color: '#9be8ff', count: 80, speed: 1, size: 1, radius: 0.5 },
  rain: { position: [0, 4, 0], color: '#a8c8e8', count: 400, speed: 1, size: 1, radius: 12 },
  wind: { position: [0, 1.5, 0], color: '#d8e2ea', count: 140, speed: 1, size: 1, radius: 12 },
}

function makeEffect(kind: EffectKind, n?: number): EffectDef {
  const d = EFFECT_DEFAULTS[kind]
  return {
    id: newId(),
    name: n ? `${EFFECT_LABELS[kind]} ${n}` : EFFECT_LABELS[kind],
    kind,
    ...d,
    position: [...d.position],
  }
}

/** 旧形式 (env のトグル) で保存されたパーティクル設定をエフェクトに変換する */
function legacyEnvEffects(env: EnvSettings): EffectDef[] {
  const legacy = env as EnvSettings & {
    sparkleEnabled?: boolean
    lightMotesEnabled?: boolean
    dustEnabled?: boolean
  }
  const out: EffectDef[] = []
  if (legacy.sparkleEnabled) out.push(makeEffect('sparkle', 1))
  if (legacy.lightMotesEnabled) out.push(makeEffect('mote', 1))
  if (legacy.dustEnabled) out.push(makeEffect('dust', 1))
  return out
}

export const defaultMotion = (): CameraMotion => ({
  enabled: false,
  yawDeg: 12,
  pitchDeg: 0,
  dolly: 0,
  speed: 8,
})

export const defaultLightPulse = (): LightPulse => ({
  enabled: true,
  mode: 'pulse',
  min: 0.15,
  speed: 1.5,
})

export const defaultLightColorCycle = (base = '#ff3df0'): LightColorCycle => ({
  enabled: true,
  mode: 'gradient',
  hueRange: 60,
  colors: [base, '#3df0ff', '#f0e63d'],
  speed: 4,
})

export const defaultRoot = (): SceneRoot => ({
  position: [0, 0, 0],
  rotation: [0, 0, 0],
  scale: 1,
  spinY: 0,
})

export const defaultTour = (): TourSettings => ({
  enabled: false,
  dwell: 1.6,
  transition: 2,
  loop: true,
  easing: 'easeInOut',
})

const defaultCamera = (): CameraSettings => ({
  focalLength: 35,
  exposure: 1,
  dofEnabled: false,
  focusMode: 'subject',
  manualFocusDistance: 10,
  aperture: 2.8,
  aspect: '16:9',
  motion: defaultMotion(),
})

function starterObjects(): SceneObjectDef[] {
  return [
    {
      id: newId(),
      name: 'Cube 1',
      kind: 'cube',
      position: [0, 0.5, 0],
      rotation: [0, 0.5, 0],
      scale: [1, 1, 1],
      material: defaultMaterial(),
    },
  ]
}

function starterLights(): LightDef[] {
  return [
    {
      id: newId(),
      name: 'Key Light',
      kind: 'directional',
      color: '#fff4e0',
      intensity: 3,
      position: [5, 8, 4],
      castShadow: true,
    },
  ]
}

interface StoreState {
  sceneName: string
  /** content hash -> dataURL。GLB / 画像テクスチャの実体 */
  assets: Record<string, string>
  objects: SceneObjectDef[]
  lights: LightDef[]
  effects: EffectDef[]
  env: EnvSettings
  camera: CameraSettings
  shots: Shot[]
  activeShotId: string | null
  /** シーン全体の見せ方変換(回転/移動/スケール/ターンテーブル) */
  root: SceneRoot
  /** 視点ツアー(複数 shot を自動で巡る) */
  tour: TourSettings
  /** shot id -> サムネ dataURL。Scene JSON / Undo には含めない (別管理) */
  shotThumbnails: Record<string, string>
  mode: Mode
  tab: Tab
  selected: Selection | null
  transformMode: 'translate' | 'rotate' | 'scale'
  transformDragging: boolean
  /** Screen Point フォーカスや Shot 再生で使う注視点 */
  focusTarget: Vec3 | null
  helpVisible: boolean
  statusMessage: string
  recording: boolean
  viewerLocked: boolean
  /** 公開 Viewer (/s/{id}) で表示する作者名。null=非表示 */
  viewerAuthor: string | null
  /** Viewer が公開データを読み込み中か (デフォルトキューブを出さないため) */
  viewerLoading: boolean
  /** インクリメントで CameraRig が active shot のポーズを適用する */
  poseStamp: number
  /** インクリメントで FlyControls が視点をリセットする */
  resetStamp: number
  canUndo: boolean
  canRedo: boolean
  /** クラウド認証ユーザー。null=未サインイン。Undo / Scene JSON の対象外 */
  cloudUser: { uid: string; name: string | null } | null
  /** クラウド処理中フラグ (保存/読込のスピナー用) */
  cloudBusy: boolean
  /** 現在のシーンに対応するクラウドドキュメント ID。再保存で上書きするために保持 */
  cloudSceneId: string | null
  /** 現在のシーンの公開先 showcases/{id}。再公開で同じ URL を上書きするために保持 */
  publishedId: string | null
  /** free-fly の移動速度 (m/s)。操作設定なので Undo / Scene JSON の対象外 */
  moveSpeed: number
  /** 視点ドラッグの感度倍率 */
  lookSensitivity: number

  setSceneName: (name: string) => void
  setMode: (mode: Mode) => void
  setTab: (tab: Tab) => void
  select: (sel: Selection | null) => void
  cycleSelection: () => void
  setTransformMode: (m: 'translate' | 'rotate' | 'scale') => void
  setMoveSpeed: (v: number) => void
  setLookSensitivity: (v: number) => void
  setCloudUser: (u: { uid: string; name: string | null } | null) => void
  setCloudBusy: (v: boolean) => void
  setCloudSceneId: (id: string | null) => void
  setPublishedId: (id: string | null) => void
  setTransformDragging: (v: boolean) => void
  setFocusTarget: (p: Vec3 | null) => void
  toggleHelp: () => void
  flash: (msg: string) => void
  setRecording: (v: boolean) => void
  resetView: () => void

  /** dataURL を assets に登録して id を返す(内容が同じなら既存 id を再利用) */
  registerAsset: (dataUrl: string) => Promise<string>
  /** ライブラリ等から、内容ハッシュ(=key)と URL を指定してアセットを登録する */
  registerAssetUrl: (hash: string, url: string) => void
  /** どのオブジェクトからも参照されなくなった asset を削除する */
  pruneAssets: () => void
  addCube: () => void
  addPlane: (textureAssetId?: string, aspect?: number, name?: string) => void
  addGlb: (assetId: string, name: string) => void
  autoScaleGlb: (id: string, maxDim: number) => void
  updateObject: (id: string, patch: Partial<SceneObjectDef>) => void
  updateMaterial: (id: string, patch: Partial<MaterialSettings>) => void
  removeObject: (id: string) => void
  duplicateObject: (id: string) => void

  addLight: (kind: LightKind) => void
  updateLight: (id: string, patch: Partial<LightDef>) => void
  setLightPulse: (id: string, patch: Partial<LightPulse>) => void
  setLightColorCycle: (id: string, patch: Partial<LightColorCycle>) => void
  removeLight: (id: string) => void

  addEffect: (kind: EffectKind) => void
  updateEffect: (id: string, patch: Partial<EffectDef>) => void
  removeEffect: (id: string) => void

  setEnv: (patch: Partial<EnvSettings>) => void
  setSceneRoot: (patch: Partial<SceneRoot>) => void
  setTour: (patch: Partial<TourSettings>) => void
  setCamera: (patch: Partial<CameraSettings>) => void
  setCameraMotion: (patch: Partial<CameraMotion>) => void
  /** HD-2D 風の look プリセットを適用する (docs/hd2d-look.md 参照) */
  applyHd2dLook: () => void
  /** 見せ方プリセット (背景/霧/ライトリグ) を適用する (src/presets.ts) */
  applyLookPreset: (presetId: string) => void

  saveShot: () => void
  applyShot: (id: string) => void
  deleteShot: (id: string) => void
  /** Shot の並び順を入れ替える(ツアーの巡回順)。dir=-1 上 / +1 下 */
  moveShot: (id: string, dir: -1 | 1) => void
  /** 現在のキャンバスフレームから shot のサムネを生成 (rAF で確定フレーム取得) */
  captureShotThumbnail: (id: string) => void
  deleteSelected: () => void

  serialize: () => SceneFile
  loadScene: (file: SceneFile) => void

  undo: () => void
  redo: () => void
}

/** Undo / Redo の対象になる「ドキュメント」部分 */
type DocSnapshot = Pick<
  StoreState,
  | 'sceneName'
  | 'assets'
  | 'objects'
  | 'lights'
  | 'effects'
  | 'env'
  | 'camera'
  | 'shots'
  | 'activeShotId'
  | 'root'
  | 'tour'
>

const DOC_KEYS = [
  'sceneName',
  'assets',
  'objects',
  'lights',
  'effects',
  'env',
  'camera',
  'shots',
  'activeShotId',
  'root',
  'tour',
] as const

function pickDoc(s: StoreState): DocSnapshot {
  return {
    sceneName: s.sceneName,
    assets: s.assets,
    objects: s.objects,
    lights: s.lights,
    effects: s.effects,
    env: s.env,
    camera: s.camera,
    shots: s.shots,
    activeShotId: s.activeShotId,
    root: s.root,
    tour: s.tour,
  }
}

const HISTORY_LIMIT = 100
/** この間隔(ms)以内の連続変更はひとつの履歴にまとめる(スライダー・ギズモ操作向け) */
const HISTORY_COALESCE_MS = 500

const undoStack: DocSnapshot[] = []
const redoStack: DocSnapshot[] = []
let restoringHistory = false
let lastDocChangeAt = 0

/** 選択中の対象がスナップショット内にも存在するなら選択を維持する */
function keepSelection(snapshot: DocSnapshot, selected: Selection | null): Selection | null {
  if (!selected) return null
  const exists =
    selected.type === 'object'
      ? snapshot.objects.some((o) => o.id === selected.id)
      : selected.type === 'light'
        ? snapshot.lights.some((l) => l.id === selected.id)
        : snapshot.effects.some((e) => e.id === selected.id)
  return exists ? selected : null
}

function makeShotFromCamera(name: string, state: StoreState): Shot | null {
  const cam = runtime.camera
  if (!cam) return null
  let focusTarget: Vec3 | null = null
  if (state.camera.focusMode === 'subject' && state.selected?.type === 'object') {
    const obj = state.objects.find((o) => o.id === state.selected!.id)
    if (obj) focusTarget = [...obj.position]
  } else if (state.camera.focusMode === 'screenPoint') {
    focusTarget = state.focusTarget ? [...state.focusTarget] : null
  }
  return {
    id: newId(),
    name,
    position: [cam.position.x, cam.position.y, cam.position.z],
    quaternion: [cam.quaternion.x, cam.quaternion.y, cam.quaternion.z, cam.quaternion.w],
    settings: { ...state.camera },
    focusTarget,
  }
}

type ViewerTarget =
  | { kind: 'local'; slug: string } // 旧: IndexedDB / localStorage
  | { kind: 'cloud'; id: string } // 新: Firestore 公開シーン /s/{id}

function detectViewerTarget(): ViewerTarget | null {
  const params = new URLSearchParams(window.location.search)
  const cloudMatch = window.location.pathname.match(/\/s\/([\w-]+)/)
  if (cloudMatch) return { kind: 'cloud', id: cloudMatch[1] }
  const pathMatch = window.location.pathname.match(/\/showcase\/([\w-]+)/)
  const slug = params.get('showcase') ?? pathMatch?.[1] ?? null
  return slug ? { kind: 'local', slug } : null
}

const viewerTarget = detectViewerTarget()

const CONTROL_PREFS_KEY = 'pse:control'

function loadControlPrefs(): { moveSpeed?: number; lookSensitivity?: number } {
  try {
    const raw = localStorage.getItem(CONTROL_PREFS_KEY)
    return raw ? (JSON.parse(raw) as { moveSpeed?: number; lookSensitivity?: number }) : {}
  } catch {
    return {}
  }
}

function saveControlPrefs(moveSpeed: number, lookSensitivity: number) {
  try {
    localStorage.setItem(CONTROL_PREFS_KEY, JSON.stringify({ moveSpeed, lookSensitivity }))
  } catch {
    /* 保存できなくても操作には影響しない */
  }
}

const controlPrefs = loadControlPrefs()

let flashTimer: ReturnType<typeof setTimeout> | undefined

declare global {
  interface Window {
    /** dev ビルドのみ: デバッグ用 store 参照 */
    __pse?: unknown
  }
}

export const useStore = create<StoreState>()((set, get) => ({
  sceneName: 'untitled-showcase',
  assets: {},
  objects: starterObjects(),
  lights: starterLights(),
  effects: [],
  env: defaultEnv(),
  camera: defaultCamera(),
  shots: [],
  root: defaultRoot(),
  tour: defaultTour(),
  shotThumbnails: {},
  activeShotId: null,
  mode: 'edit',
  tab: 'edit',
  selected: null,
  transformMode: 'translate',
  transformDragging: false,
  focusTarget: null,
  helpVisible: false,
  statusMessage: '',
  recording: false,
  viewerLocked: false,
  viewerAuthor: null,
  viewerLoading: false,
  poseStamp: 0,
  resetStamp: 0,
  canUndo: false,
  canRedo: false,
  cloudUser: null,
  cloudBusy: false,
  cloudSceneId: null,
  publishedId: null,
  moveSpeed: controlPrefs.moveSpeed ?? 4,
  lookSensitivity: controlPrefs.lookSensitivity ?? 1,
  // Viewer 起動時は読み込みが終わるまで空シーン+ロード中にする
  // (デフォルトキューブが一瞬見えるのを防ぐ)
  ...(viewerTarget
    ? {
        viewerLocked: true,
        viewerLoading: true,
        mode: 'preview' as Mode,
        objects: [],
        lights: [],
        effects: [],
      }
    : {}),

  setSceneName: (name) => set({ sceneName: name }),

  setMode: (mode) => {
    const s = get()
    if (s.viewerLocked) return
    if (mode === 'preview') {
      let shots = s.shots
      let shot = shots.find((x) => x.id === s.activeShotId) ?? shots[shots.length - 1]
      if (!shot) {
        const auto = makeShotFromCamera(`Shot ${shots.length + 1}`, s)
        if (!auto) return
        shots = [...shots, auto]
        shot = auto
        get().flash('Shot を自動保存して Preview に入りました')
      }
      set({
        mode: 'preview',
        shots,
        activeShotId: shot.id,
        // 動きループは live (スライダー) を保持して即プレビューできるようにする
        camera: { ...shot.settings, motion: s.camera.motion },
        focusTarget: shot.focusTarget,
        selected: null,
        poseStamp: s.poseStamp + 1,
      })
      return
    }
    set({ mode, tab: mode === 'camera' ? 'camera' : s.tab })
  },

  setTab: (tab) => set({ tab }),

  select: (sel) => {
    set({ selected: sel })
    if (sel) {
      set({ tab: sel.type === 'object' ? 'object' : sel.type === 'light' ? 'light' : 'fx' })
    }
  },

  cycleSelection: () => {
    const s = get()
    const all: Selection[] = [
      ...s.objects.map((o): Selection => ({ type: 'object', id: o.id })),
      ...s.lights.map((l): Selection => ({ type: 'light', id: l.id })),
      ...s.effects.map((e): Selection => ({ type: 'effect', id: e.id })),
    ]
    if (!all.length) return
    const idx = s.selected ? all.findIndex((x) => x.id === s.selected!.id) : -1
    get().select(all[(idx + 1) % all.length])
  },

  setTransformMode: (transformMode) => set({ transformMode }),

  setMoveSpeed: (moveSpeed) => {
    set({ moveSpeed })
    saveControlPrefs(moveSpeed, get().lookSensitivity)
  },

  setLookSensitivity: (lookSensitivity) => {
    set({ lookSensitivity })
    saveControlPrefs(get().moveSpeed, lookSensitivity)
  },
  setCloudUser: (cloudUser) => set({ cloudUser }),
  setCloudBusy: (cloudBusy) => set({ cloudBusy }),
  setCloudSceneId: (cloudSceneId) => set({ cloudSceneId }),
  setPublishedId: (publishedId) => set({ publishedId }),
  setTransformDragging: (transformDragging) => set({ transformDragging }),
  setFocusTarget: (focusTarget) => set({ focusTarget }),
  toggleHelp: () => set((s) => ({ helpVisible: !s.helpVisible })),

  flash: (statusMessage) => {
    set({ statusMessage })
    if (flashTimer) clearTimeout(flashTimer)
    flashTimer = setTimeout(() => set({ statusMessage: '' }), 2600)
  },

  setRecording: (recording) => set({ recording }),
  resetView: () => set((s) => ({ resetStamp: s.resetStamp + 1 })),

  registerAsset: async (dataUrl) => {
    const id = await hashDataUrl(dataUrl)
    if (!get().assets[id]) {
      set((s) => ({ assets: { ...s.assets, [id]: dataUrl } }))
    }
    return id
  },

  registerAssetUrl: (hash, url) => {
    if (!get().assets[hash]) {
      set((s) => ({ assets: { ...s.assets, [hash]: url } }))
    }
  },

  pruneAssets: () => {
    const s = get()
    const used = new Set<string>()
    for (const o of s.objects) {
      if (o.glbAssetId) used.add(o.glbAssetId)
      if (o.material.textureAssetId) used.add(o.material.textureAssetId)
    }
    const keys = Object.keys(s.assets)
    if (keys.every((k) => used.has(k))) return
    const assets: Record<string, string> = {}
    for (const k of keys) if (used.has(k)) assets[k] = s.assets[k]
    set({ assets })
  },

  addCube: () => {
    const obj: SceneObjectDef = {
      id: newId(),
      name: `Cube ${get().objects.length + 1}`,
      kind: 'cube',
      position: [0, 0.5, 0],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
      material: defaultMaterial(),
    }
    set((s) => ({ objects: [...s.objects, obj] }))
    get().select({ type: 'object', id: obj.id })
  },

  addPlane: (textureAssetId, aspect = 1, name) => {
    const obj: SceneObjectDef = {
      id: newId(),
      name: name ?? `Plane ${get().objects.length + 1}`,
      kind: 'plane',
      position: [0, 1, 0],
      rotation: [0, 0, 0],
      scale: [2 * aspect, 2, 1],
      material: { ...defaultMaterial(), color: '#ffffff', textureAssetId },
    }
    set((s) => ({ objects: [...s.objects, obj] }))
    get().select({ type: 'object', id: obj.id })
  },

  addGlb: (assetId, name) => {
    const obj: SceneObjectDef = {
      id: newId(),
      name,
      kind: 'glb',
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
      material: defaultMaterial(),
      glbAssetId: assetId,
    }
    pendingGlbNormalize.add(obj.id) // ロード後に bounding box で正規化(TASK-042)
    set((s) => ({ objects: [...s.objects, obj] }))
    get().select({ type: 'object', id: obj.id })
  },

  // GLB ロード完了時に呼ぶ。addGlb 直後で未調整(scale [1,1,1])のものだけ、
  // 最大寸法 maxDim を GLB_TARGET_SIZE に合わせて自動スケールする。
  autoScaleGlb: (id, maxDim) => {
    if (!pendingGlbNormalize.has(id) || !(maxDim > 0)) return
    pendingGlbNormalize.delete(id)
    const obj = get().objects.find((o) => o.id === id)
    if (!obj || obj.scale[0] !== 1 || obj.scale[1] !== 1 || obj.scale[2] !== 1) return
    const f = Math.max(0.0001, Math.min(1000, GLB_TARGET_SIZE / maxDim))
    get().updateObject(id, { scale: [f, f, f] })
  },

  updateObject: (id, patch) =>
    set((s) => ({ objects: s.objects.map((o) => (o.id === id ? { ...o, ...patch } : o)) })),

  updateMaterial: (id, patch) =>
    set((s) => ({
      objects: s.objects.map((o) =>
        o.id === id ? { ...o, material: { ...o.material, ...patch } } : o,
      ),
    })),

  removeObject: (id) => {
    set((s) => ({
      objects: s.objects.filter((o) => o.id !== id),
      selected: s.selected?.id === id ? null : s.selected,
    }))
    get().pruneAssets()
  },

  duplicateObject: (id) => {
    const src = get().objects.find((o) => o.id === id)
    if (!src) return
    const copy: SceneObjectDef = {
      ...src,
      id: newId(),
      name: `${src.name} copy`,
      position: [src.position[0] + 1, src.position[1], src.position[2]],
      material: { ...src.material },
    }
    set((s) => ({ objects: [...s.objects, copy] }))
    get().select({ type: 'object', id: copy.id })
  },

  addLight: (kind) => {
    const defaults: Record<LightKind, { intensity: number; color: string }> = {
      directional: { intensity: 3, color: '#ffffff' },
      point: { intensity: 50, color: '#ffd9a0' },
      spot: { intensity: 80, color: '#ffffff' },
    }
    const light: LightDef = {
      id: newId(),
      name: `${kind} ${get().lights.length + 1}`,
      kind,
      color: defaults[kind].color,
      intensity: defaults[kind].intensity,
      position: [3, 4, 2],
      castShadow: kind !== 'point',
    }
    set((s) => ({ lights: [...s.lights, light] }))
    get().select({ type: 'light', id: light.id })
  },

  updateLight: (id, patch) =>
    set((s) => ({ lights: s.lights.map((l) => (l.id === id ? { ...l, ...patch } : l)) })),

  setLightPulse: (id, patch) =>
    set((s) => ({
      lights: s.lights.map((l) =>
        l.id === id ? { ...l, pulse: { ...(l.pulse ?? defaultLightPulse()), ...patch } } : l,
      ),
    })),

  setLightColorCycle: (id, patch) =>
    set((s) => ({
      lights: s.lights.map((l) =>
        l.id === id
          ? { ...l, colorCycle: { ...(l.colorCycle ?? defaultLightColorCycle(l.color)), ...patch } }
          : l,
      ),
    })),

  removeLight: (id) =>
    set((s) => ({
      lights: s.lights.filter((l) => l.id !== id),
      selected: s.selected?.id === id ? null : s.selected,
    })),

  addEffect: (kind) => {
    const n = get().effects.filter((e) => e.kind === kind).length
    const eff = makeEffect(kind, n + 1)
    set((s) => ({ effects: [...s.effects, eff] }))
    get().select({ type: 'effect', id: eff.id })
  },

  updateEffect: (id, patch) =>
    set((s) => ({ effects: s.effects.map((e) => (e.id === id ? { ...e, ...patch } : e)) })),

  removeEffect: (id) =>
    set((s) => ({
      effects: s.effects.filter((e) => e.id !== id),
      selected: s.selected?.id === id ? null : s.selected,
    })),

  setEnv: (patch) => set((s) => ({ env: { ...s.env, ...patch } })),
  setSceneRoot: (patch) => set((s) => ({ root: { ...s.root, ...patch } })),
  setTour: (patch) => set((s) => ({ tour: { ...s.tour, ...patch } })),
  setCamera: (patch) => set((s) => ({ camera: { ...s.camera, ...patch } })),
  setCameraMotion: (patch) =>
    set((s) => ({
      camera: { ...s.camera, motion: { ...(s.camera.motion ?? defaultMotion()), ...patch } },
    })),

  applyLookPreset: (presetId) => {
    const preset = LOOK_PRESETS.find((p) => p.id === presetId)
    if (!preset) return
    // ライトリグは既存ライトを置き換える (id は採番)。env/camera はマージ。
    const lights: LightDef[] = preset.lights.map((l) => ({ ...l, id: newId() }))
    set((s) => ({
      env: { ...s.env, ...preset.env },
      lights,
      camera: { ...s.camera, ...(preset.camera ?? {}) },
      selected: s.selected?.type === 'light' ? null : s.selected,
    }))
    get().flash(`プリセット「${preset.name}」を適用しました`)
  },

  applyHd2dLook: () => {
    const s = get()
    set({
      env: {
        ...s.env,
        backgroundColor: '#0c0f1a',
        ambientColor: '#7c8ec4',
        ambientIntensity: 0.35,
        fogEnabled: true,
        fogColor: '#141c33',
        fogNear: 12,
        fogFar: 50,
        bloomEnabled: true,
        bloomIntensity: 1.3,
        vignetteEnabled: true,
        vignetteDarkness: 0.8,
        groundColor: '#171b26',
      },
      camera: {
        ...s.camera,
        dofEnabled: true,
        aperture: 1.8,
        focalLength: 50,
        exposure: 1.15,
      },
    })
    // キーライト: 先頭の Directional を暖色 + 影ありに。無ければ追加する
    const key = get().lights.find((l) => l.kind === 'directional')
    if (key) {
      get().updateLight(key.id, { color: '#ffd9a8', intensity: 3.5, castShadow: true })
    } else {
      const light: LightDef = {
        id: newId(),
        name: 'Key Light',
        kind: 'directional',
        color: '#ffd9a8',
        intensity: 3.5,
        position: [6, 10, 4],
        castShadow: true,
      }
      set((s2) => ({ lights: [...s2.lights, light] }))
    }
    get().flash('HD-2D look を適用しました (Cmd/Ctrl+Z で元に戻せます)')
  },

  saveShot: () => {
    const s = get()
    if (s.viewerLocked) return
    const shot = makeShotFromCamera(`Shot ${s.shots.length + 1}`, s)
    if (!shot) return
    set({ shots: [...s.shots, shot], activeShotId: shot.id })
    get().captureShotThumbnail(shot.id)
    get().flash(`${shot.name} を保存しました (P で Preview)`)
  },

  captureShotThumbnail: (id) => {
    const canvas = runtime.canvas
    if (!canvas || typeof requestAnimationFrame === 'undefined') return
    // 確定フレームを得るため次の描画後にキャプチャする
    requestAnimationFrame(() => {
      try {
        // OG カード (X summary_large_image) でも綺麗に見えるよう大きめに撮る。
        // Shot 一覧は <img> 側で縮小表示するので問題ない。canvas が小さければそのまま。
        const w = Math.min(1200, canvas.width)
        const h = Math.max(1, Math.round((canvas.height / canvas.width) * w)) || 675
        const off = document.createElement('canvas')
        off.width = w
        off.height = h
        const ctx = off.getContext('2d')
        if (!ctx) return
        ctx.drawImage(canvas, 0, 0, w, h)
        const url = off.toDataURL('image/jpeg', 0.85)
        set((s) => ({ shotThumbnails: { ...s.shotThumbnails, [id]: url } }))
      } catch {
        /* 描画バッファ未保持などでは無視 */
      }
    })
  },

  applyShot: (id) => {
    const s = get()
    const shot = s.shots.find((x) => x.id === id)
    if (!shot) return
    set({
      activeShotId: shot.id,
      camera: { ...shot.settings },
      focusTarget: shot.focusTarget,
      poseStamp: s.poseStamp + 1,
    })
  },

  deleteShot: (id) =>
    set((s) => {
      const { [id]: _removed, ...shotThumbnails } = s.shotThumbnails
      return {
        shots: s.shots.filter((x) => x.id !== id),
        activeShotId: s.activeShotId === id ? null : s.activeShotId,
        shotThumbnails,
      }
    }),

  moveShot: (id, dir) =>
    set((s) => {
      const i = s.shots.findIndex((x) => x.id === id)
      const j = i + dir
      if (i < 0 || j < 0 || j >= s.shots.length) return {}
      const shots = s.shots.slice()
      ;[shots[i], shots[j]] = [shots[j], shots[i]]
      return { shots }
    }),

  deleteSelected: () => {
    const s = get()
    if (!s.selected) return
    if (s.selected.type === 'object') s.removeObject(s.selected.id)
    else if (s.selected.type === 'light') s.removeLight(s.selected.id)
    else s.removeEffect(s.selected.id)
  },

  serialize: () => {
    const s = get()
    return {
      version: 2 as const,
      name: s.sceneName,
      assets: s.assets,
      objects: s.objects,
      lights: s.lights,
      effects: s.effects,
      env: s.env,
      camera: s.camera,
      shots: s.shots,
      activeShotId: s.activeShotId,
      root: s.root,
      tour: s.tour,
    }
  },

  loadScene: (file) => {
    const f = migrateSceneFile(file)
    set({
      sceneName: f.name,
      assets: f.assets,
      objects: f.objects,
      lights: f.lights,
      effects: f.effects ?? legacyEnvEffects(f.env),
      // 古い Scene JSON に無い設定はデフォルト値で補完する
      env: { ...defaultEnv(), ...f.env },
      camera: f.camera,
      shots: f.shots,
      activeShotId: f.activeShotId,
      root: { ...defaultRoot(), ...f.root },
      tour: { ...defaultTour(), ...f.tour },
      selected: null,
      mode: 'edit',
      focusTarget: null,
      cloudSceneId: null,
      publishedId: null,
    })
    get().flash(`Scene "${f.name}" を読み込みました`)
  },

  undo: () => {
    if (get().viewerLocked) return
    const past = undoStack.pop()
    if (!past) return
    redoStack.push(pickDoc(get()))
    restoringHistory = true
    set({
      ...past,
      selected: keepSelection(past, get().selected),
      canUndo: undoStack.length > 0,
      canRedo: true,
    })
    restoringHistory = false
    lastDocChangeAt = 0
    get().flash('元に戻しました')
  },

  redo: () => {
    if (get().viewerLocked) return
    const next = redoStack.pop()
    if (!next) return
    undoStack.push(pickDoc(get()))
    if (undoStack.length > HISTORY_LIMIT) undoStack.shift()
    restoringHistory = true
    set({
      ...next,
      selected: keepSelection(next, get().selected),
      canUndo: true,
      canRedo: redoStack.length > 0,
    })
    restoringHistory = false
    lastDocChangeAt = 0
    get().flash('やり直しました')
  },
}))

// ドキュメント部分の変更を監視して undo 履歴を積む。
// 直前の変更から HISTORY_COALESCE_MS 以内ならひとつのジェスチャとして扱う。
useStore.subscribe((state, prev) => {
  if (restoringHistory) return
  if (!DOC_KEYS.some((k) => state[k] !== prev[k])) return
  const now = Date.now()
  if (now - lastDocChangeAt > HISTORY_COALESCE_MS) {
    undoStack.push(pickDoc(prev))
    if (undoStack.length > HISTORY_LIMIT) undoStack.shift()
  }
  redoStack.length = 0
  lastDocChangeAt = now
  if (!state.canUndo || state.canRedo) {
    useStore.setState({ canUndo: true, canRedo: false })
  }
})

/** 読み込んだ公開シーンを固定画角 Viewer に反映する。 */
function applyViewerScene(file: SceneFile, author: string | null) {
  const f = migrateSceneFile(file)
  const shot = f.shots.find((s) => s.id === f.activeShotId) ?? f.shots[0]
  restoringHistory = true
  useStore.setState({
    sceneName: f.name,
    viewerAuthor: author,
    viewerLoading: false,
    assets: f.assets,
    objects: f.objects,
    lights: f.lights,
    effects: f.effects ?? legacyEnvEffects(f.env),
    env: { ...defaultEnv(), ...f.env },
    shots: f.shots,
    activeShotId: shot?.id ?? null,
    camera: shot ? { ...shot.settings } : f.camera,
    focusTarget: shot?.focusTarget ?? null,
    root: { ...defaultRoot(), ...f.root },
    tour: { ...defaultTour(), ...f.tour },
    poseStamp: useStore.getState().poseStamp + 1,
  })
  restoringHistory = false
}

// Viewer 起動: /s/{id}=Firestore 公開シーン、?showcase=slug=旧 IndexedDB/localStorage
if (viewerTarget) {
  void (async () => {
    if (viewerTarget.kind === 'cloud') {
      try {
        const { loadPublicShowcase } = await import('./cloud/publish')
        const result = await loadPublicShowcase(viewerTarget.id)
        if (!result) {
          useStore.setState({ sceneName: 'この公開シーンは見つかりません', viewerLoading: false })
          return
        }
        applyViewerScene(result.file, result.author)
      } catch {
        useStore.setState({ sceneName: '公開シーンの読み込みに失敗しました', viewerLoading: false })
      }
      return
    }

    let file: SceneFile | null = null
    try {
      file = await loadShow(viewerTarget.slug)
    } catch {
      /* IndexedDB が使えない環境では localStorage フォールバックへ */
    }
    if (!file) {
      const raw = localStorage.getItem(`pse:show:${viewerTarget.slug}`)
      if (raw) {
        try {
          file = JSON.parse(raw) as SceneFile
        } catch {
          file = null
        }
      }
    }
    if (!file) {
      useStore.setState({ sceneName: `"${viewerTarget.slug}" が見つかりません`, viewerLoading: false })
      return
    }
    applyViewerScene(file, null)
  })()
}

// 編集ストアをグローバル公開。dev のデバッグに加え、ヘッドレス描画(MCP の
// render_scene が本番アプリに loadScene を注入してスクショ)に使う。
// 露出するのはローカル編集状態のみ。クラウド書き込みは認証/Rules でゲート済み。
window.__pse = useStore
