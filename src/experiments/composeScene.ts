import * as THREE from 'three'
import type {
  CameraSettings,
  EnvSettings,
  LightDef,
  MaterialSettings,
  SceneFile,
  SceneObjectDef,
  Shot,
  Vec3,
  Vec4,
} from '../types'

/**
 * TASK-034 実験: アカウントのアセットから「破綻のない・見せ方品質を保った」
 * 展示シーンを *プログラムで* 生成できるかを検証するためのコンポーザ。
 *
 * 新しい公開サーフェスは作らない。これは純関数で、入力アセット配列から
 * SceneFile(loadScene でそのまま読める)を組み立てる。AI/スクリプトが
 * これを呼べば人手編集なしにシーンを量産できる、という仮説の核を試す。
 */

export interface ComposerAsset {
  /** assets テーブルのキー(= content hash) */
  hash: string
  /** dataURL または https URL(実体) */
  url: string
  kind: 'glb' | 'image'
  name: string
  /** image のみ: 幅/高さ。無ければ 1 */
  aspect?: number
}

export interface ComposeOptions {
  name?: string
  /** アイテム間の間隔 m */
  spacing?: number
  /** 軽いターンテーブル回転を付ける */
  turntable?: boolean
}

const id = () => Math.random().toString(16).slice(2, 10)

function material(): MaterialSettings {
  return { color: '#ffffff', metalness: 0, roughness: 1, emissive: '#000000', emissiveIntensity: 0, pixelated: true }
}

/** 見せ方品質寄りの環境(地面あり/グリッド無し/軽い霧・ブルーム・周辺減光) */
function presentationEnv(): EnvSettings {
  return {
    backgroundColor: '#0e1018',
    ambientColor: '#5566aa',
    ambientIntensity: 0.5,
    fogEnabled: true,
    fogColor: '#0e1018',
    fogNear: 12,
    fogFar: 48,
    bloomEnabled: true,
    bloomIntensity: 0.5,
    vignetteEnabled: true,
    vignetteDarkness: 0.6,
    gridVisible: false,
    groundVisible: true,
    groundColor: '#1a1d27',
  }
}

function cameraSettings(): CameraSettings {
  return {
    focalLength: 45,
    exposure: 1,
    dofEnabled: false,
    focusMode: 'subject',
    manualFocusDistance: 10,
    aperture: 2.8,
    aspect: '16:9',
  }
}

/** 三灯ライティング(キー/フィル/リム)で立体感を出す */
function threePointLights(): LightDef[] {
  return [
    { id: id(), name: 'Key', kind: 'directional', color: '#fff1de', intensity: 3.2, position: [4, 7, 5], castShadow: true },
    { id: id(), name: 'Fill', kind: 'directional', color: '#9fb6ff', intensity: 1.1, position: [-5, 3, 3], castShadow: false },
    { id: id(), name: 'Rim', kind: 'directional', color: '#ffd9a8', intensity: 1.6, position: [-2, 4, -6], castShadow: false },
  ]
}

/**
 * アセット群を浅いアーチ状に並べ、三灯ライト + 3/4 フレーミングの Shot を付けた
 * SceneFile を返す。objects は原点中心に左右対称配置(全部がフレームに収まる)。
 */
export function composeScene(assets: ComposerAsset[], opts: ComposeOptions = {}): SceneFile {
  const spacing = opts.spacing ?? 2.4
  const n = assets.length
  const objects: SceneObjectDef[] = []
  const assetsMap: Record<string, string> = {}

  assets.forEach((a, i) => {
    assetsMap[a.hash] = a.url
    // -0.5..0.5 を中心に左右対称。端ほど少し奥へ引く(浅いアーチ)。
    const t = n <= 1 ? 0 : i / (n - 1) - 0.5
    const x = t * spacing * Math.max(1, n - 1)
    const z = -Math.abs(t) * spacing * 0.5
    const yaw = -t * 0.6 // 端を内側に向ける
    if (a.kind === 'glb') {
      const o: SceneObjectDef = {
        id: id(),
        name: a.name,
        kind: 'glb',
        position: [x, 0, z],
        rotation: [0, yaw, 0],
        scale: [1, 1, 1],
        material: material(),
        glbAssetId: a.hash,
      }
      // motion は undefined キーを作らない(Firestore は undefined を拒否する)
      if (opts.turntable) {
        o.motion = { enabled: true, moveX: 0, moveY: 0, moveZ: 0, spinY: 18, speed: 8, easing: 'linear' }
      }
      objects.push(o)
    } else {
      const aspect = a.aspect && a.aspect > 0 ? a.aspect : 1
      const h = 1.6
      objects.push({
        id: id(),
        name: a.name,
        kind: 'plane',
        position: [x, h / 2, z],
        rotation: [0, yaw, 0],
        scale: [h * aspect, h, 1],
        material: { ...material(), textureAssetId: a.hash },
      })
    }
  })

  // 3/4 フレーミング: 列全体の幅に応じて引く。被写体が画面中央に来るよう
  // 引きすぎず、目線高さ寄りから中心を注視する(下寄り構図を回避)。
  const width = spacing * Math.max(1, n - 1) + 1.4
  const dist = Math.max(4.5, width * 0.7 + 2.2)
  const eye = new THREE.Vector3(width * 0.16, 1.5, dist)
  const target = new THREE.Vector3(0, 1.0, -0.2)
  const m = new THREE.Matrix4().lookAt(eye, target, new THREE.Vector3(0, 1, 0))
  const q = new THREE.Quaternion().setFromRotationMatrix(m)

  const shot: Shot = {
    id: id(),
    name: 'Auto Shot',
    position: [eye.x, eye.y, eye.z] as Vec3,
    quaternion: [q.x, q.y, q.z, q.w] as Vec4,
    settings: cameraSettings(),
    focusTarget: [target.x, target.y, target.z] as Vec3,
  }

  return {
    version: 2,
    name: opts.name ?? 'AI 生成シーン',
    assets: assetsMap,
    objects,
    lights: threePointLights(),
    effects: [],
    env: presentationEnv(),
    camera: cameraSettings(),
    shots: [shot],
    activeShotId: shot.id,
  }
}
