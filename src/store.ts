import { create } from 'zustand'
import type * as THREE from 'three'
import type {
  AspectRatio,
  CameraSettings,
  EnvSettings,
  LightDef,
  LightKind,
  MaterialSettings,
  Mode,
  SceneFile,
  SceneObjectDef,
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

const defaultCamera = (): CameraSettings => ({
  focalLength: 35,
  exposure: 1,
  dofEnabled: false,
  focusMode: 'subject',
  manualFocusDistance: 10,
  aperture: 2.8,
  aspect: '16:9',
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
  objects: SceneObjectDef[]
  lights: LightDef[]
  env: EnvSettings
  camera: CameraSettings
  shots: Shot[]
  activeShotId: string | null
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
  /** インクリメントで CameraRig が active shot のポーズを適用する */
  poseStamp: number
  /** インクリメントで FlyControls が視点をリセットする */
  resetStamp: number
  canUndo: boolean
  canRedo: boolean

  setSceneName: (name: string) => void
  setMode: (mode: Mode) => void
  setTab: (tab: Tab) => void
  select: (sel: Selection | null) => void
  cycleSelection: () => void
  setTransformMode: (m: 'translate' | 'rotate' | 'scale') => void
  setTransformDragging: (v: boolean) => void
  setFocusTarget: (p: Vec3 | null) => void
  toggleHelp: () => void
  flash: (msg: string) => void
  setRecording: (v: boolean) => void
  resetView: () => void

  addCube: () => void
  addPlane: (textureDataUrl?: string, aspect?: number, name?: string) => void
  addGlb: (dataUrl: string, name: string) => void
  updateObject: (id: string, patch: Partial<SceneObjectDef>) => void
  updateMaterial: (id: string, patch: Partial<MaterialSettings>) => void
  removeObject: (id: string) => void
  duplicateObject: (id: string) => void

  addLight: (kind: LightKind) => void
  updateLight: (id: string, patch: Partial<LightDef>) => void
  removeLight: (id: string) => void

  setEnv: (patch: Partial<EnvSettings>) => void
  setCamera: (patch: Partial<CameraSettings>) => void

  saveShot: () => void
  applyShot: (id: string) => void
  deleteShot: (id: string) => void
  deleteSelected: () => void

  serialize: () => SceneFile
  loadScene: (file: SceneFile) => void

  undo: () => void
  redo: () => void
}

/** Undo / Redo の対象になる「ドキュメント」部分 */
type DocSnapshot = Pick<
  StoreState,
  'sceneName' | 'objects' | 'lights' | 'env' | 'camera' | 'shots' | 'activeShotId'
>

const DOC_KEYS = [
  'sceneName',
  'objects',
  'lights',
  'env',
  'camera',
  'shots',
  'activeShotId',
] as const

function pickDoc(s: StoreState): DocSnapshot {
  return {
    sceneName: s.sceneName,
    objects: s.objects,
    lights: s.lights,
    env: s.env,
    camera: s.camera,
    shots: s.shots,
    activeShotId: s.activeShotId,
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
      : snapshot.lights.some((l) => l.id === selected.id)
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

function viewerInit(): Partial<StoreState> | null {
  const params = new URLSearchParams(window.location.search)
  const pathMatch = window.location.pathname.match(/\/showcase\/([\w-]+)/)
  const slug = params.get('showcase') ?? pathMatch?.[1] ?? null
  if (!slug) return null
  const raw = localStorage.getItem(`pse:show:${slug}`)
  if (!raw) return null
  try {
    const file = JSON.parse(raw) as SceneFile
    const shot = file.shots.find((s) => s.id === file.activeShotId) ?? file.shots[0]
    return {
      sceneName: file.name,
      objects: file.objects,
      lights: file.lights,
      env: file.env,
      camera: shot ? { ...shot.settings } : file.camera,
      shots: file.shots,
      activeShotId: shot?.id ?? null,
      focusTarget: shot?.focusTarget ?? null,
      mode: 'preview',
      viewerLocked: true,
      poseStamp: 1,
    }
  } catch {
    return null
  }
}

let flashTimer: ReturnType<typeof setTimeout> | undefined

declare global {
  interface Window {
    /** dev ビルドのみ: デバッグ用 store 参照 */
    __pse?: unknown
  }
}

export const useStore = create<StoreState>()((set, get) => ({
  sceneName: 'untitled-showcase',
  objects: starterObjects(),
  lights: starterLights(),
  env: defaultEnv(),
  camera: defaultCamera(),
  shots: [],
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
  poseStamp: 0,
  resetStamp: 0,
  canUndo: false,
  canRedo: false,
  ...viewerInit(),

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
        camera: { ...shot.settings },
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
    if (sel) set({ tab: sel.type === 'object' ? 'object' : 'light' })
  },

  cycleSelection: () => {
    const s = get()
    const all: Selection[] = [
      ...s.objects.map((o): Selection => ({ type: 'object', id: o.id })),
      ...s.lights.map((l): Selection => ({ type: 'light', id: l.id })),
    ]
    if (!all.length) return
    const idx = s.selected ? all.findIndex((x) => x.id === s.selected!.id) : -1
    get().select(all[(idx + 1) % all.length])
  },

  setTransformMode: (transformMode) => set({ transformMode }),
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

  addPlane: (textureDataUrl, aspect = 1, name) => {
    const obj: SceneObjectDef = {
      id: newId(),
      name: name ?? `Plane ${get().objects.length + 1}`,
      kind: 'plane',
      position: [0, 1, 0],
      rotation: [0, 0, 0],
      scale: [2 * aspect, 2, 1],
      material: { ...defaultMaterial(), color: '#ffffff', textureDataUrl },
    }
    set((s) => ({ objects: [...s.objects, obj] }))
    get().select({ type: 'object', id: obj.id })
  },

  addGlb: (dataUrl, name) => {
    const obj: SceneObjectDef = {
      id: newId(),
      name,
      kind: 'glb',
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
      material: defaultMaterial(),
      glbDataUrl: dataUrl,
    }
    set((s) => ({ objects: [...s.objects, obj] }))
    get().select({ type: 'object', id: obj.id })
  },

  updateObject: (id, patch) =>
    set((s) => ({ objects: s.objects.map((o) => (o.id === id ? { ...o, ...patch } : o)) })),

  updateMaterial: (id, patch) =>
    set((s) => ({
      objects: s.objects.map((o) =>
        o.id === id ? { ...o, material: { ...o.material, ...patch } } : o,
      ),
    })),

  removeObject: (id) =>
    set((s) => ({
      objects: s.objects.filter((o) => o.id !== id),
      selected: s.selected?.id === id ? null : s.selected,
    })),

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

  removeLight: (id) =>
    set((s) => ({
      lights: s.lights.filter((l) => l.id !== id),
      selected: s.selected?.id === id ? null : s.selected,
    })),

  setEnv: (patch) => set((s) => ({ env: { ...s.env, ...patch } })),
  setCamera: (patch) => set((s) => ({ camera: { ...s.camera, ...patch } })),

  saveShot: () => {
    const s = get()
    if (s.viewerLocked) return
    const shot = makeShotFromCamera(`Shot ${s.shots.length + 1}`, s)
    if (!shot) return
    set({ shots: [...s.shots, shot], activeShotId: shot.id })
    get().flash(`${shot.name} を保存しました (P で Preview)`)
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
    set((s) => ({
      shots: s.shots.filter((x) => x.id !== id),
      activeShotId: s.activeShotId === id ? null : s.activeShotId,
    })),

  deleteSelected: () => {
    const s = get()
    if (!s.selected) return
    if (s.selected.type === 'object') s.removeObject(s.selected.id)
    else s.removeLight(s.selected.id)
  },

  serialize: () => {
    const s = get()
    return {
      version: 1,
      name: s.sceneName,
      objects: s.objects,
      lights: s.lights,
      env: s.env,
      camera: s.camera,
      shots: s.shots,
      activeShotId: s.activeShotId,
    }
  },

  loadScene: (file) => {
    set({
      sceneName: file.name,
      objects: file.objects,
      lights: file.lights,
      env: file.env,
      camera: file.camera,
      shots: file.shots,
      activeShotId: file.activeShotId,
      selected: null,
      mode: 'edit',
      focusTarget: null,
    })
    get().flash(`Scene "${file.name}" を読み込みました`)
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

if (import.meta.env.DEV) {
  window.__pse = useStore
}
