import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { runtime, useStore } from '../store'
import type { EffectDef, EffectKind } from '../types'

let sharedTexture: THREE.Texture | null = null

/** 柔らかい円形グラデーションのパーティクル用テクスチャ(全エフェクトで共有) */
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

/** 粒の基本サイズ (m)。EffectDef.size を乗算して使う */
const BASE_SIZE: Record<EffectKind, number> = {
  sparkle: 0.12,
  mote: 0.3,
  dust: 0.06,
  flame: 0.3,
  splash: 0.09,
  electric: 0.1,
}

const ADDITIVE: Record<EffectKind, boolean> = {
  sparkle: true,
  mote: true,
  dust: false,
  flame: true,
  splash: false,
  electric: true,
}

function makeMaterial(additive: boolean): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uMap: { value: particleTexture() },
      uScale: { value: 1000 },
    },
    vertexShader: /* glsl */ `
      attribute float aSize;
      attribute float aAlpha;
      attribute vec3 aColor;
      uniform float uScale;
      varying float vAlpha;
      varying vec3 vColor;
      void main() {
        vAlpha = aAlpha;
        vColor = aColor;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = aSize * uScale / -mv.z;
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D uMap;
      varying float vAlpha;
      varying vec3 vColor;
      void main() {
        float a = texture2D(uMap, gl_PointCoord).a * vAlpha;
        if (a < 0.01) discard;
        gl_FragColor = vec4(vColor, a);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
  })
}

interface Sim {
  pos: Float32Array
  vel: Float32Array
  life: Float32Array
  phase: Float32Array
  vary: Float32Array
  color: Float32Array
  alpha: Float32Array
  sizeArr: Float32Array
}

/** 粒を初期位置に(再)配置する。座標は def.position を原点とするローカル */
function spawn(kind: EffectKind, i: number, s: Sim, radius: number, scatter: boolean) {
  switch (kind) {
    case 'sparkle':
    case 'mote':
    case 'dust': {
      const ySpan = Math.max(1.5, radius * 0.25)
      s.pos[i * 3] = (Math.random() * 2 - 1) * radius
      s.pos[i * 3 + 1] = (Math.random() * 2 - 1) * ySpan
      s.pos[i * 3 + 2] = (Math.random() * 2 - 1) * radius
      break
    }
    case 'flame': {
      const a = Math.random() * Math.PI * 2
      const rr = Math.random() * radius
      s.pos[i * 3] = Math.cos(a) * rr
      s.pos[i * 3 + 1] = 0
      s.pos[i * 3 + 2] = Math.sin(a) * rr
      s.life[i] = scatter ? Math.random() : 0
      break
    }
    case 'splash': {
      s.pos[i * 3] = (Math.random() * 2 - 1) * radius * 0.3
      s.pos[i * 3 + 1] = 0
      s.pos[i * 3 + 2] = (Math.random() * 2 - 1) * radius * 0.3
      const a = Math.random() * Math.PI * 2
      const lateral = (0.3 + Math.random() * 0.9) * (radius * 2 + 0.5)
      s.vel[i * 3] = Math.cos(a) * lateral
      s.vel[i * 3 + 1] = 2.2 + Math.random() * 1.8
      s.vel[i * 3 + 2] = Math.sin(a) * lateral
      s.life[i] = scatter ? Math.random() : 0
      break
    }
    case 'electric': {
      const a = Math.random() * Math.PI * 2
      const b = Math.random() * Math.PI - Math.PI / 2
      const rr = radius * Math.cbrt(Math.random())
      s.pos[i * 3] = Math.cos(a) * Math.cos(b) * rr
      s.pos[i * 3 + 1] = Math.sin(b) * rr
      s.pos[i * 3 + 2] = Math.sin(a) * Math.cos(b) * rr
      break
    }
  }
}

const tmpColor = new THREE.Color()

export function EffectNode({ def }: { def: EffectDef }) {
  const mode = useStore((s) => s.mode)
  const viewerLocked = useStore((s) => s.viewerLocked)
  const groupRef = useRef<THREE.Group>(null)
  const showMarker = mode === 'edit' && !viewerLocked

  useEffect(() => {
    if (groupRef.current) runtime.objects.set(def.id, groupRef.current)
    return () => {
      runtime.objects.delete(def.id)
    }
  }, [def.id])

  const sim = useMemo<Sim>(() => {
    const n = def.count
    const s: Sim = {
      pos: new Float32Array(n * 3),
      vel: new Float32Array(n * 3),
      life: new Float32Array(n),
      phase: new Float32Array(n),
      vary: new Float32Array(n),
      color: new Float32Array(n * 3),
      alpha: new Float32Array(n),
      sizeArr: new Float32Array(n),
    }
    for (let i = 0; i < n; i++) {
      s.phase[i] = Math.random() * Math.PI * 2
      s.vary[i] = 0.6 + Math.random() * 0.8
      spawn(def.kind, i, s, def.radius, true)
    }
    return s
    // radius 変更時は再配置し直したほうが自然なので依存に含める
  }, [def.count, def.kind, def.radius])

  const geom = useMemo(() => {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(sim.pos, 3))
    g.setAttribute('aColor', new THREE.BufferAttribute(sim.color, 3))
    g.setAttribute('aAlpha', new THREE.BufferAttribute(sim.alpha, 1))
    g.setAttribute('aSize', new THREE.BufferAttribute(sim.sizeArr, 1))
    return g
  }, [sim])

  const mat = useMemo(() => makeMaterial(ADDITIVE[def.kind]), [def.kind])

  useEffect(() => () => geom.dispose(), [geom])
  useEffect(() => () => mat.dispose(), [mat])

  useFrame((state, rawDt) => {
    const d = Math.min(rawDt, 0.05) * def.speed
    const t = state.clock.elapsedTime
    const base = tmpColor.set(def.color)
    const baseSize = BASE_SIZE[def.kind] * def.size
    const n = def.count
    const { pos, vel, life, phase, vary, color, alpha, sizeArr } = sim

    for (let i = 0; i < n; i++) {
      let k = 1
      let sizeK = 1
      switch (def.kind) {
        case 'sparkle': {
          let y = pos[i * 3 + 1] - 0.06 * vary[i] * d
          const ySpan = Math.max(1.5, def.radius * 0.25)
          if (y < -ySpan) y = ySpan
          pos[i * 3 + 1] = y
          pos[i * 3] += Math.sin(t * 0.4 + phase[i]) * 0.25 * d
          pos[i * 3 + 2] += Math.cos(t * 0.35 + phase[i]) * 0.25 * d
          k = 0.05 + 0.95 * (0.5 + 0.5 * Math.sin(t * 3.2 * def.speed * vary[i] + phase[i]))
          alpha[i] = 0.85 * k
          break
        }
        case 'mote': {
          let y = pos[i * 3 + 1] + 0.15 * vary[i] * d
          const ySpan = Math.max(1.5, def.radius * 0.25)
          if (y > ySpan) y = -ySpan
          pos[i * 3 + 1] = y
          pos[i * 3] += Math.sin(t * 0.4 + phase[i]) * 0.5 * d
          pos[i * 3 + 2] += Math.cos(t * 0.35 + phase[i]) * 0.5 * d
          alpha[i] =
            0.9 * (0.25 + 0.75 * (0.5 + 0.5 * Math.sin(t * 1.1 * def.speed * vary[i] + phase[i])))
          break
        }
        case 'dust': {
          let y = pos[i * 3 + 1] - 0.1 * vary[i] * d
          const ySpan = Math.max(1.5, def.radius * 0.25)
          if (y < -ySpan) y = ySpan
          pos[i * 3 + 1] = y
          pos[i * 3] += Math.sin(t * 0.3 + phase[i]) * 0.12 * d
          pos[i * 3 + 2] += Math.cos(t * 0.25 + phase[i]) * 0.12 * d
          alpha[i] = 0.35
          break
        }
        case 'flame': {
          life[i] += d / (0.6 + 0.6 * (vary[i] - 0.6))
          if (life[i] >= 1) {
            spawn('flame', i, sim, def.radius, false)
          }
          const l = life[i]
          pos[i * 3 + 1] += 1.5 * vary[i] * d
          pos[i * 3] += Math.sin(t * 6 + phase[i]) * 0.18 * d
          pos[i * 3 + 2] += Math.cos(t * 5.3 + phase[i]) * 0.18 * d
          alpha[i] = Math.max(0, (1 - l) * 0.95)
          sizeK = 1 - l * 0.6
          k = 1.25 - l * 0.8 // 根元ほど明るく
          break
        }
        case 'splash': {
          life[i] += d / 1.2
          vel[i * 3 + 1] -= 7 * d
          pos[i * 3] += vel[i * 3] * d
          pos[i * 3 + 1] += vel[i * 3 + 1] * d
          pos[i * 3 + 2] += vel[i * 3 + 2] * d
          if (pos[i * 3 + 1] < 0 || life[i] >= 1) {
            spawn('splash', i, sim, def.radius, false)
          }
          alpha[i] = 0.85 * (1 - life[i] * 0.5)
          break
        }
        case 'electric': {
          // 時々ランダムに飛び移り、高速で明滅する
          if (Math.random() < 0.25) spawn('electric', i, sim, def.radius, false)
          alpha[i] = Math.sin(t * 40 * def.speed + phase[i] * 7) > 0.2 ? 1 : 0.05
          break
        }
      }
      color[i * 3] = base.r * k
      color[i * 3 + 1] = base.g * k
      color[i * 3 + 2] = base.b * k
      sizeArr[i] = baseSize * vary[i] * sizeK
    }

    geom.attributes.position.needsUpdate = true
    geom.attributes.aColor.needsUpdate = true
    geom.attributes.aAlpha.needsUpdate = true
    geom.attributes.aSize.needsUpdate = true

    const cam = state.camera as THREE.PerspectiveCamera
    mat.uniforms.uScale.value =
      (state.size.height * state.viewport.dpr) / (2 * Math.tan((cam.fov * Math.PI) / 360))
  })

  return (
    <group ref={groupRef} position={def.position}>
      <points geometry={geom} material={mat} frustumCulled={false} raycast={() => null} />
      <mesh
        visible={showMarker}
        onPointerDown={(e) => {
          const s = useStore.getState()
          if (e.button === 0 && s.mode === 'edit' && !s.viewerLocked && showMarker) {
            e.stopPropagation()
            s.select({ type: 'effect', id: def.id })
          }
        }}
      >
        <octahedronGeometry args={[0.16]} />
        <meshBasicMaterial color={def.color} wireframe />
      </mesh>
    </group>
  )
}
