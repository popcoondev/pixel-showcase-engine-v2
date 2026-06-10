import { useEffect, useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'

let sharedTexture: THREE.Texture | null = null

/** 柔らかい円形グラデーションのパーティクル用テクスチャ(全 variant で共有) */
function particleTexture(): THREE.Texture {
  if (sharedTexture) return sharedTexture
  const size = 64
  const cv = document.createElement('canvas')
  cv.width = cv.height = size
  const ctx = cv.getContext('2d')!
  const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
  grad.addColorStop(0, 'rgba(255,255,255,1)')
  grad.addColorStop(0.4, 'rgba(255,255,255,0.6)')
  grad.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = grad
  ctx.fillRect(0, 0, size, size)
  sharedTexture = new THREE.CanvasTexture(cv)
  return sharedTexture
}

export type ParticleVariant = 'sparkle' | 'mote' | 'dust'

interface VariantConfig {
  count: number
  size: number
  color: string
  opacity: number
  additive: boolean
  radius: number
  yMin: number
  yMax: number
  /** 正で上昇、負で落下 (m/s) */
  ySpeed: number
  /** 水平方向の揺らぎ幅 */
  sway: number
  /** 明滅速度。0 で明滅なし */
  twinkle: number
  /** 明滅の最小輝度 (0-1) */
  twinkleMin: number
}

const CONFIGS: Record<ParticleVariant, VariantConfig> = {
  // キラキラの霧: 細かい粒が明滅しながらゆっくり沈む
  sparkle: {
    count: 260,
    size: 0.12,
    color: '#cfe4ff',
    opacity: 0.85,
    additive: true,
    radius: 16,
    yMin: 0.2,
    yMax: 5.5,
    ySpeed: -0.06,
    sway: 0.25,
    twinkle: 3.2,
    twinkleMin: 0.05,
  },
  // 光の粒: 蛍のような大きめの光球がゆっくり昇る
  mote: {
    count: 48,
    size: 0.3,
    color: '#ffd9a0',
    opacity: 0.9,
    additive: true,
    radius: 14,
    yMin: 0.3,
    yMax: 4.5,
    ySpeed: 0.15,
    sway: 0.5,
    twinkle: 1.1,
    twinkleMin: 0.25,
  },
  // ダスト: 空気中の塵。控えめな通常ブレンドで漂う
  dust: {
    count: 340,
    size: 0.06,
    color: '#d8d4c8',
    opacity: 0.35,
    additive: false,
    radius: 14,
    yMin: 0.05,
    yMax: 6,
    ySpeed: -0.1,
    sway: 0.12,
    twinkle: 0,
    twinkleMin: 1,
  },
}

export function ParticleField({ variant }: { variant: ParticleVariant }) {
  const cfg = CONFIGS[variant]

  const data = useMemo(() => {
    const positions = new Float32Array(cfg.count * 3)
    const colors = new Float32Array(cfg.count * 3)
    const phases = new Float32Array(cfg.count)
    const speeds = new Float32Array(cfg.count)
    const base = new THREE.Color(cfg.color)
    for (let i = 0; i < cfg.count; i++) {
      positions[i * 3] = (Math.random() * 2 - 1) * cfg.radius
      positions[i * 3 + 1] = cfg.yMin + Math.random() * (cfg.yMax - cfg.yMin)
      positions[i * 3 + 2] = (Math.random() * 2 - 1) * cfg.radius
      colors[i * 3] = base.r
      colors[i * 3 + 1] = base.g
      colors[i * 3 + 2] = base.b
      phases[i] = Math.random() * Math.PI * 2
      speeds[i] = 0.6 + Math.random() * 0.8
    }
    return { positions, colors, phases, speeds, base }
  }, [cfg])

  const geom = useMemo(() => {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(data.positions, 3))
    g.setAttribute('color', new THREE.BufferAttribute(data.colors, 3))
    return g
  }, [data])

  const mat = useMemo(
    () =>
      new THREE.PointsMaterial({
        map: particleTexture(),
        size: cfg.size,
        transparent: true,
        opacity: cfg.opacity,
        vertexColors: true,
        depthWrite: false,
        sizeAttenuation: true,
        blending: cfg.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      }),
    [cfg],
  )

  useEffect(() => () => geom.dispose(), [geom])
  useEffect(() => () => mat.dispose(), [mat])

  useFrame((state, dt) => {
    const t = state.clock.elapsedTime
    const d = Math.min(dt, 0.05)
    const { positions, colors, phases, speeds, base } = data
    for (let i = 0; i < cfg.count; i++) {
      let y = positions[i * 3 + 1] + cfg.ySpeed * speeds[i] * d
      if (y < cfg.yMin) y = cfg.yMax
      if (y > cfg.yMax) y = cfg.yMin
      positions[i * 3 + 1] = y
      positions[i * 3] += Math.sin(t * 0.4 + phases[i]) * cfg.sway * d
      positions[i * 3 + 2] += Math.cos(t * 0.35 + phases[i]) * cfg.sway * d
      if (cfg.twinkle > 0) {
        const k =
          cfg.twinkleMin +
          (1 - cfg.twinkleMin) * (0.5 + 0.5 * Math.sin(t * cfg.twinkle * speeds[i] + phases[i]))
        colors[i * 3] = base.r * k
        colors[i * 3 + 1] = base.g * k
        colors[i * 3 + 2] = base.b * k
      }
    }
    geom.attributes.position.needsUpdate = true
    if (cfg.twinkle > 0) geom.attributes.color.needsUpdate = true
  })

  return <points geometry={geom} material={mat} frustumCulled={false} raycast={() => null} />
}
