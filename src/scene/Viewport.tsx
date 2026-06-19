import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber'
import { Billboard, Grid, TransformControls } from '@react-three/drei'
import {
  Bloom,
  DepthOfField,
  EffectComposer,
  ToneMapping,
  Vignette,
} from '@react-three/postprocessing'
import { Effect, ToneMappingMode, type DepthOfFieldEffect } from 'postprocessing'
import * as THREE from 'three'
import { focalToFov, runtime, useStore } from '../store'
import type {
  EasingKind,
  LightColorCycle,
  LightDef,
  MaterialSettings,
  SceneObjectDef,
  Selection,
  Vec3,
} from '../types'
import { EffectNode } from './EffectNode'
import { ease, easeOsc } from './easing'
import { FlyControls } from './FlyControls'
import { useGifTexture } from './gifTexture'
import { enableShadows, loadGltf } from './gltfLoader'

/** クリック共通処理: Camera モードの Screen Point フォーカス、Edit モードの選択 */
function handleScenePointerDown(e: ThreeEvent<PointerEvent>, sel: Selection | null) {
  if (e.button !== 0) return
  // ギズモのハンドルにホバー中(=ギズモ操作の意図)は選択しない。
  // 重なったオブジェクトの矢印を掴んだとき、裏のオブジェに選択が切り替わるのを防ぐ。
  if (runtime.gizmo?.axis) return
  const s = useStore.getState()
  if (s.mode === 'camera' && s.camera.dofEnabled && s.camera.focusMode === 'screenPoint') {
    e.stopPropagation()
    s.setFocusTarget([e.point.x, e.point.y, e.point.z])
    s.flash('フォーカス位置を設定しました')
    return
  }
  if (s.mode === 'edit' && sel && !s.viewerLocked) {
    e.stopPropagation()
    s.select(sel)
  }
}

function StdMaterial({ m, side }: { m: MaterialSettings; side?: THREE.Side }) {
  const textureUrl = useStore((s) =>
    m.textureAssetId ? s.assets[m.textureAssetId] : undefined,
  )
  // GIF はループ再生する animated texture、それ以外は静止テクスチャ。
  // 静止側は GIF のデコード完了までのプレースホルダ(1フレーム目)も兼ねる。
  const gifTex = useGifTexture(textureUrl)
  const staticTex = useMemo(() => {
    if (!textureUrl) return null
    const t = new THREE.TextureLoader().load(textureUrl)
    t.colorSpace = THREE.SRGBColorSpace
    return t
  }, [textureUrl])
  const tex = gifTex ?? staticTex

  useEffect(() => {
    if (!tex) return
    tex.magFilter = m.pixelated ? THREE.NearestFilter : THREE.LinearFilter
    tex.needsUpdate = true
  }, [tex, m.pixelated])

  // gif texture は hook 側で破棄する。ここでは自前の静止テクスチャのみ破棄。
  useEffect(() => () => staticTex?.dispose(), [staticTex])

  return (
    <meshStandardMaterial
      color={m.color}
      metalness={m.metalness}
      roughness={m.roughness}
      emissive={m.emissive}
      emissiveIntensity={m.emissiveIntensity}
      map={tex}
      side={side}
      transparent={!!tex}
      alphaTest={0.01}
    />
  )
}

interface OrigMat {
  metalness: number
  roughness: number
  emissive: THREE.Color | null
  emissiveIntensity: number
  magFilter: THREE.MagnificationTextureFilter | null
}

/** override=true なら質感設定を適用、false なら読み込み時の質感に戻す */
function applyGlbMaterials(
  root: THREE.Object3D,
  originals: Map<string, OrigMat>,
  m: MaterialSettings,
  override: boolean,
) {
  root.traverse((o) => {
    const mesh = o as THREE.Mesh
    if (!mesh.isMesh) return
    const mats = (
      Array.isArray(mesh.material) ? mesh.material : [mesh.material]
    ) as THREE.MeshStandardMaterial[]
    for (const mat of mats) {
      if (!mat) continue
      let orig = originals.get(mat.uuid)
      if (!orig) {
        orig = {
          metalness: 'metalness' in mat ? mat.metalness : 0,
          roughness: 'roughness' in mat ? mat.roughness : 1,
          emissive: mat.emissive ? mat.emissive.clone() : null,
          emissiveIntensity: mat.emissiveIntensity ?? 1,
          magFilter: mat.map ? mat.map.magFilter : null,
        }
        originals.set(mat.uuid, orig)
      }
      if ('metalness' in mat) mat.metalness = override ? m.metalness : orig.metalness
      if ('roughness' in mat) mat.roughness = override ? m.roughness : orig.roughness
      if (mat.emissive && orig.emissive) {
        if (override) {
          mat.emissive.set(m.emissive)
          mat.emissiveIntensity = m.emissiveIntensity
        } else {
          mat.emissive.copy(orig.emissive)
          mat.emissiveIntensity = orig.emissiveIntensity
        }
      }
      if (mat.map && orig.magFilter !== null) {
        const filter = override && m.pixelated ? THREE.NearestFilter : orig.magFilter
        if (mat.map.magFilter !== filter) {
          mat.map.magFilter = filter
          mat.map.needsUpdate = true
        }
      }
    }
  })
}

function GlbContent({ def }: { def: SceneObjectDef }) {
  const url = useStore((s) => (def.glbAssetId ? s.assets[def.glbAssetId] : undefined))
  const [obj, setObj] = useState<THREE.Group | null>(null)
  const originals = useRef(new Map<string, OrigMat>())

  useEffect(() => {
    if (!url) return
    let alive = true
    originals.current.clear()
    loadGltf(url)
      .then((gltf) => {
        if (!alive) return
        enableShadows(gltf.scene)
        // TASK-042: 追加直後の GLB を bounding box の最大寸法で正規化する
        const size = new THREE.Vector3()
        new THREE.Box3().setFromObject(gltf.scene).getSize(size)
        useStore.getState().autoScaleGlb(def.id, Math.max(size.x, size.y, size.z))
        setObj(gltf.scene)
      })
      .catch(() => {
        if (alive) useStore.getState().flash('GLB の読み込みに失敗しました')
      })
    return () => {
      alive = false
    }
  }, [url])

  useEffect(() => {
    if (obj) applyGlbMaterials(obj, originals.current, def.material, def.materialOverride ?? false)
  }, [obj, def.material, def.materialOverride])

  return obj ? <primitive object={obj} /> : null
}

function ObjectNode({ def }: { def: SceneObjectDef }) {
  const ref = useRef<THREE.Group>(null)
  useEffect(() => {
    if (ref.current) runtime.objects.set(def.id, ref.current)
    return () => {
      runtime.objects.delete(def.id)
    }
  }, [def.id])

  // 動きループ: Preview/Viewer で基準位置周りにオシレーション + 連続回転。
  // motion 未設定のオブジェクトは何もしない(宣言的 props が静止保持)。
  useFrame((state) => {
    const g = ref.current
    const m = def.motion
    if (!g || !m) return
    const s = useStore.getState()
    const framed = s.mode === 'preview' || s.viewerLocked
    if (!framed || !m.enabled) {
      // 静止: 基準に戻す(ただしギズモ操作中は触らない)
      if (!s.transformDragging) {
        g.position.set(...def.position)
        g.rotation.set(...def.rotation)
      }
      return
    }
    const t = state.clock.elapsedTime
    const ph = (Math.PI * 2 * t) / Math.max(1, m.speed) + Math.PI * 2 * (m.phase ?? 0)
    g.position.set(
      def.position[0] + m.moveX * easeOsc(m.easing, Math.sin(ph)),
      def.position[1] + m.moveY * easeOsc(m.easing, Math.sin(ph + Math.PI / 2)),
      def.position[2] + m.moveZ * easeOsc(m.easing, Math.sin(ph + Math.PI)),
    )
    g.rotation.set(
      def.rotation[0],
      def.rotation[1] + THREE.MathUtils.degToRad(m.spinY) * t,
      def.rotation[2],
    )
  })

  return (
    <group
      ref={ref}
      position={def.position}
      rotation={def.rotation}
      scale={def.scale}
      onPointerDown={(e) => handleScenePointerDown(e, { type: 'object', id: def.id })}
    >
      {def.kind === 'cube' && (
        <mesh castShadow receiveShadow>
          <boxGeometry />
          <StdMaterial m={def.material} />
        </mesh>
      )}
      {def.kind === 'plane' && (
        <mesh castShadow>
          <planeGeometry />
          <StdMaterial m={def.material} side={THREE.DoubleSide} />
        </mesh>
      )}
      {def.kind === 'glb' && def.glbAssetId && <GlbContent def={def} />}
    </group>
  )
}

const CC_HSL = { h: 0, s: 0, l: 0 }
const CC_A = new THREE.Color()
const CC_B = new THREE.Color()

/** 色サイクルを target に書き込む。base=基準色, t=共有クロック秒 */
function applyColorCycle(target: THREE.Color, base: string, cc: LightColorCycle, t: number) {
  const speed = Math.max(0.05, cc.speed)
  const tp = t + (cc.phase ?? 0) * speed // 位相 = 1 周期ぶんの時間シフト
  if (cc.mode === 'hue') {
    target.set(base)
    target.getHSL(CC_HSL)
    const h = (CC_HSL.h + (cc.hueRange / 360) * Math.sin((Math.PI * 2 * tp) / speed) + 1) % 1
    target.setHSL(h, CC_HSL.s, CC_HSL.l)
    return
  }
  // gradient: 2〜4 色を巡回
  const cols = cc.colors && cc.colors.length >= 2 ? cc.colors : [base, base]
  const n = cols.length
  const u = ((((tp / speed) % 1) + 1) % 1) * n
  const i = Math.floor(u) % n
  const f = u - Math.floor(u)
  CC_A.set(cols[i])
  CC_B.set(cols[(i + 1) % n])
  target.copy(CC_A).lerp(CC_B, f)
}

/** 発光ループ: 経過時間 t(秒)から基準強度に対する係数 0..1 を返す。phase=共有クロック上の位相 0..1 */
function pulseFactor(
  mode: 'pulse' | 'blink' | 'flicker',
  t: number,
  speed: number,
  easing?: EasingKind,
  phase = 0,
): number {
  // 位相を 1 周期ぶんの時間シフトとして全モードに反映(共有クロックで交互/連動)
  const tp = t + phase / Math.max(speed, 0.05)
  const ph = Math.PI * 2 * tp * speed
  if (mode === 'blink') return Math.sin(ph) >= 0 ? 1 : 0
  if (mode === 'flicker') {
    // 不規則(ネオン管のちらつき): 非整数倍の正弦を合成し、明側に寄せる
    const v = (Math.sin(tp * speed * 8.1) + Math.sin(tp * speed * 15.3) + Math.sin(tp * speed * 23.7)) / 3
    return Math.pow(0.5 + 0.5 * v, 0.45)
  }
  // pulse: 柔らかい明滅(イージングで溜め/抜けを付けられる)
  return ease(easing, 0.5 + 0.5 * Math.sin(ph))
}

function LightNode({ def }: { def: LightDef }) {
  const proxyRef = useRef<THREE.Group>(null)
  const lightRef = useRef<THREE.Light>(null)
  const mode = useStore((s) => s.mode)
  const viewerLocked = useStore((s) => s.viewerLocked)
  const showProxy = mode === 'edit' && !viewerLocked

  useEffect(() => {
    if (proxyRef.current) runtime.objects.set(def.id, proxyRef.current)
    return () => {
      runtime.objects.delete(def.id)
    }
  }, [def.id])

  // 発光ループ + 色サイクル: Preview/Viewer で intensity / color を変調。Edit では基準値で静止。
  useFrame((state) => {
    const l = lightRef.current
    if (!l) return
    const framed = mode === 'preview' || viewerLocked
    const t = state.clock.elapsedTime
    // 明滅
    const p = def.pulse
    if (p && p.enabled && framed) {
      const k = pulseFactor(p.mode, t, Math.max(0.05, p.speed), p.easing, p.phase ?? 0)
      l.intensity = def.intensity * (p.min + (1 - p.min) * k)
    } else {
      l.intensity = def.intensity
    }
    // 色サイクル
    const cc = def.colorCycle
    if (cc && cc.enabled && framed) {
      applyColorCycle(l.color, def.color, cc, t)
    } else {
      l.color.set(def.color)
    }
  })

  return (
    <>
      {def.kind === 'directional' && (
        <directionalLight
          ref={lightRef}
          position={def.position}
          color={def.color}
          intensity={def.intensity}
          castShadow={def.castShadow}
          shadow-mapSize={[2048, 2048]}
          shadow-bias={-0.0004}
          shadow-camera-left={-15}
          shadow-camera-right={15}
          shadow-camera-top={15}
          shadow-camera-bottom={-15}
          shadow-camera-far={60}
        />
      )}
      {def.kind === 'point' && (
        <pointLight
          ref={lightRef}
          position={def.position}
          color={def.color}
          intensity={def.intensity}
          castShadow={def.castShadow}
          shadow-bias={-0.0004}
        />
      )}
      {def.kind === 'spot' && (
        <spotLight
          ref={lightRef}
          position={def.position}
          color={def.color}
          intensity={def.intensity}
          angle={0.6}
          penumbra={0.5}
          castShadow={def.castShadow}
          shadow-bias={-0.0004}
        />
      )}
      <group
        ref={proxyRef}
        position={def.position}
        visible={showProxy}
        onPointerDown={(e) => {
          if (showProxy) handleScenePointerDown(e, { type: 'light', id: def.id })
        }}
      >
        <mesh>
          <sphereGeometry args={[0.18, 12, 12]} />
          <meshBasicMaterial color={def.color} wireframe />
        </mesh>
      </group>
    </>
  )
}

function Ground() {
  const env = useStore((s) => s.env)
  return (
    <>
      {env.groundVisible && (
        <mesh
          rotation-x={-Math.PI / 2}
          position={[0, -0.001, 0]}
          receiveShadow
          onPointerDown={(e) => handleScenePointerDown(e, null)}
        >
          <planeGeometry args={[300, 300]} />
          <meshStandardMaterial color={env.groundColor} roughness={0.95} metalness={0} />
        </mesh>
      )}
      {env.gridVisible && (
        <Grid
          position={[0, 0.001, 0]}
          args={[40, 40]}
          cellColor="#33394a"
          sectionColor="#4a5775"
          fadeDistance={50}
          infiniteGrid
        />
      )}
    </>
  )
}

function SelectionGizmo() {
  const selected = useStore((s) => s.selected)
  const mode = useStore((s) => s.mode)
  const transformMode = useStore((s) => s.transformMode)
  const objects = useStore((s) => s.objects)
  const lights = useStore((s) => s.lights)
  const effects = useStore((s) => s.effects)
  const [target, setTarget] = useState<THREE.Object3D | null>(null)

  useEffect(() => {
    setTarget(selected ? (runtime.objects.get(selected.id) ?? null) : null)
  }, [selected, objects, lights, effects])

  if (!target || mode !== 'edit' || !selected) return null

  const commit = () => {
    const s = useStore.getState()
    if (!s.selected) return
    if (s.selected.type === 'object') {
      s.updateObject(s.selected.id, {
        position: [target.position.x, target.position.y, target.position.z],
        rotation: [target.rotation.x, target.rotation.y, target.rotation.z],
        scale: [target.scale.x, target.scale.y, target.scale.z],
      })
    } else if (s.selected.type === 'light') {
      s.updateLight(s.selected.id, {
        position: [target.position.x, target.position.y, target.position.z],
      })
    } else {
      s.updateEffect(s.selected.id, {
        position: [target.position.x, target.position.y, target.position.z],
      })
    }
  }

  return (
    <TransformControls
      ref={(c) => {
        runtime.gizmo = c as unknown as { axis: string | null } | null
      }}
      object={target}
      mode={selected.type === 'object' ? transformMode : 'translate'}
      onMouseDown={() => useStore.getState().setTransformDragging(true)}
      onMouseUp={() => {
        commit()
        useStore.getState().setTransformDragging(false)
      }}
      onObjectChange={commit}
    />
  )
}

// 動きループ用の再利用 THREE オブジェクト(毎フレーム new しない)
const WORLD_UP = new THREE.Vector3(0, 1, 0)
const TMP_BASE = new THREE.Vector3()
const TMP_FWD = new THREE.Vector3()
const TMP_PIVOT = new THREE.Vector3()
const TMP_REL = new THREE.Vector3()
const TMP_RIGHT = new THREE.Vector3()
const TMP_Q = new THREE.Quaternion()

function CameraRig() {
  const { camera, gl } = useThree()
  const focalLength = useStore((s) => s.camera.focalLength)
  const poseStamp = useStore((s) => s.poseStamp)

  useEffect(() => {
    runtime.camera = camera as THREE.PerspectiveCamera
    runtime.canvas = gl.domElement
  }, [camera, gl])

  useEffect(() => {
    const c = camera as THREE.PerspectiveCamera
    c.fov = focalToFov(focalLength)
    c.updateProjectionMatrix()
  }, [focalLength, camera])

  useEffect(() => {
    if (poseStamp === 0) return
    const s = useStore.getState()
    const shot = s.shots.find((x) => x.id === s.activeShotId)
    if (!shot) return
    camera.position.set(...shot.position)
    camera.quaternion.set(...shot.quaternion)
  }, [poseStamp, camera])

  // Preview / Viewer で動きループを再生(被写体周りをヨー/ピッチ/ドリーで揺らす)。
  // Edit/Camera(構図決め)では適用しない。Preview は live の camera.motion、Viewer は shot 保存値。
  useFrame((state) => {
    const s = useStore.getState()
    const framed = s.mode === 'preview' || s.viewerLocked
    if (!framed) return
    const shot = s.shots.find((x) => x.id === s.activeShotId)
    if (!shot) return
    const base = TMP_BASE.fromArray(shot.position)
    const motion = s.viewerLocked ? shot.settings.motion : s.camera.motion
    if (!motion || !motion.enabled) {
      // 動き無し: 基準ポーズに固定(toggle off で即戻る)
      camera.position.copy(base)
      camera.quaternion.set(...shot.quaternion)
      return
    }
    // 注視点(pivot): 基準カメラの前方 focus 距離
    TMP_FWD.set(0, 0, -1).applyQuaternion(TMP_Q.fromArray(shot.quaternion))
    let d =
      shot.settings.dofEnabled && shot.settings.focusMode === 'manual'
        ? shot.settings.manualFocusDistance
        : base.length()
    if (!(d > 0)) d = 6
    const pivot = TMP_PIVOT.copy(base).addScaledVector(TMP_FWD, d)
    const ph =
      (Math.PI * 2 * state.clock.elapsedTime) / Math.max(1, motion.speed) +
      Math.PI * 2 * (motion.phase ?? 0)
    const sinE = easeOsc(motion.easing, Math.sin(ph))
    const cosE = easeOsc(motion.easing, Math.cos(ph))
    const yaw = THREE.MathUtils.degToRad(motion.yawDeg) * sinE
    const pitch = THREE.MathUtils.degToRad(motion.pitchDeg) * cosE
    const dollyScale = 1 - (motion.dolly ?? 0) * sinE
    const rel = TMP_REL.copy(base).sub(pivot)
    rel.applyAxisAngle(WORLD_UP, yaw)
    const right = TMP_RIGHT.crossVectors(rel, WORLD_UP)
    if (right.lengthSq() > 1e-6) rel.applyAxisAngle(right.normalize(), pitch)
    rel.multiplyScalar(dollyScale)
    camera.position.copy(pivot).add(rel)
    camera.up.copy(WORLD_UP)
    camera.lookAt(pivot)
  })

  return null
}

const exposureFrag =
  'uniform float exposure; void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) { outputColor = vec4(inputColor.rgb * exposure, inputColor.a); }'

/** トーンマッピング前に線形空間で露出を掛けるエフェクト */
class ExposureEffectImpl extends Effect {
  constructor() {
    super('ExposureEffect', exposureFrag, {
      uniforms: new Map<string, THREE.Uniform>([['exposure', new THREE.Uniform(1)]]),
    })
  }

  setExposure(v: number) {
    this.uniforms.get('exposure')!.value = v
  }
}

/** 現在のフォーカス対象点を返す。manual のときは null */
function resolveFocusPoint(): Vec3 | null {
  const s = useStore.getState()
  const c = s.camera
  if (c.focusMode === 'manual') return null
  if (c.focusMode === 'screenPoint') return s.focusTarget
  const obj =
    s.selected?.type === 'object' ? s.objects.find((o) => o.id === s.selected!.id) : undefined
  return obj?.position ?? s.focusTarget ?? s.objects[0]?.position ?? null
}

function Effects() {
  const env = useStore((s) => s.env)
  const cam = useStore((s) => s.camera)
  const dofRef = useRef<DepthOfFieldEffect>(null)
  const exposureEffect = useMemo(() => new ExposureEffectImpl(), [])
  const focusVec = useMemo(() => new THREE.Vector3(), [])
  const dirVec = useMemo(() => new THREE.Vector3(), [])

  useEffect(() => {
    exposureEffect.setExposure(cam.exposure)
  }, [cam.exposure, exposureEffect])

  // フォーカス距離と被写界深度を毎フレーム実カメラ近似で更新する
  useFrame(() => {
    const eff = dofRef.current
    const camera = runtime.camera
    if (!eff || !camera) return
    const c = useStore.getState().camera
    const point = resolveFocusPoint()
    let dist = c.manualFocusDistance
    if (point) {
      focusVec.set(point[0], point[1], point[2])
      dist = camera.position.distanceTo(focusVec)
    } else {
      camera.getWorldDirection(dirVec)
      focusVec.copy(camera.position).addScaledVector(dirVec, dist)
    }
    eff.target = focusVec
    // 被写界深度 ≈ 2 * N * c * D^2 / f^2 (許容錯乱円 c = 30µm)
    const f = c.focalLength / 1000
    eff.cocMaterial.worldFocusRange = THREE.MathUtils.clamp(
      (2 * c.aperture * 0.00003 * dist * dist) / (f * f),
      0.05,
      600,
    )
    eff.bokehScale = THREE.MathUtils.clamp((c.focalLength / 35) * (8 / c.aperture), 0.3, 16)
  })

  const items: ReactElement[] = []
  if (cam.dofEnabled) {
    items.push(<DepthOfField key="dof" ref={dofRef} bokehScale={4} />)
  }
  items.push(<primitive key="exposure" object={exposureEffect} />)
  if (env.bloomEnabled) {
    items.push(
      <Bloom key="bloom" mipmapBlur intensity={env.bloomIntensity} luminanceThreshold={0.9} />,
    )
  }
  items.push(<ToneMapping key="tonemap" mode={ToneMappingMode.ACES_FILMIC} />)
  if (env.vignetteEnabled) {
    items.push(<Vignette key="vignette" darkness={env.vignetteDarkness} offset={0.25} />)
  }
  return <EffectComposer multisampling={4}>{items}</EffectComposer>
}

/** Screen Point フォーカスの現在位置マーカー */
function FocusMarker() {
  const cam = useStore((s) => s.camera)
  const mode = useStore((s) => s.mode)
  const focusTarget = useStore((s) => s.focusTarget)
  if (!(mode === 'camera' && cam.dofEnabled && cam.focusMode === 'screenPoint' && focusTarget)) {
    return null
  }
  return (
    <Billboard position={focusTarget}>
      <mesh raycast={() => null} renderOrder={998}>
        <ringGeometry args={[0.1, 0.14, 32]} />
        <meshBasicMaterial
          color="#ffd84a"
          transparent
          opacity={0.9}
          depthTest={false}
          side={THREE.DoubleSide}
        />
      </mesh>
      <mesh raycast={() => null} renderOrder={999}>
        <circleGeometry args={[0.03, 16]} />
        <meshBasicMaterial color="#ffd84a" depthTest={false} />
      </mesh>
    </Billboard>
  )
}

function SceneContent() {
  const env = useStore((s) => s.env)
  const objects = useStore((s) => s.objects)
  const lights = useStore((s) => s.lights)
  const effects = useStore((s) => s.effects)

  return (
    <>
      <color attach="background" args={[env.backgroundColor]} />
      {env.fogEnabled && <fog attach="fog" args={[env.fogColor, env.fogNear, env.fogFar]} />}
      <ambientLight color={env.ambientColor} intensity={env.ambientIntensity} />
      {lights.map((l) => (
        <LightNode key={l.id} def={l} />
      ))}
      {objects.map((o) => (
        <ObjectNode key={o.id} def={o} />
      ))}
      <Ground />
      {effects.map((e) => (
        <EffectNode key={e.id} def={e} />
      ))}
      <FocusMarker />
      <SelectionGizmo />
      <CameraRig />
      <FlyControls />
      <Effects />
    </>
  )
}

export function Viewport() {
  return (
    <Canvas
      shadows="percentage"
      dpr={[1, 2]}
      gl={{ preserveDrawingBuffer: true, antialias: true }}
      camera={{ position: [7, 5, 9], fov: 38, near: 0.1, far: 300 }}
      onCreated={({ gl }) => {
        // トーンマッピングは EffectComposer 側 (ToneMapping effect) で行う
        gl.toneMapping = THREE.NoToneMapping
      }}
      onPointerMissed={() => {
        if (runtime.suppressMissed) return
        const s = useStore.getState()
        if (s.mode === 'edit') s.select(null)
      }}
    >
      <SceneContent />
    </Canvas>
  )
}
