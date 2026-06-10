import { useEffect, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { runtime, useStore } from '../store'

function isTyping() {
  const el = document.activeElement
  return (
    el instanceof HTMLInputElement ||
    el instanceof HTMLTextAreaElement ||
    el instanceof HTMLSelectElement
  )
}

/**
 * Edit / Camera 共通の free-fly 操作。
 * 右ドラッグ / 何もない場所の左ドラッグ: 視点回転 / 中ドラッグ: 平行移動 /
 * ホイール: 前後 / WASD: 移動 / Space: 上昇 / Z,X,Ctrl: 下降 / Shift: 高速
 */
export function FlyControls() {
  const { camera, gl } = useThree()
  const resetStamp = useStore((s) => s.resetStamp)
  const keys = useRef(new Set<string>())
  const drag = useRef<{
    button: number
    x: number
    y: number
    /** 左ボタンのみ: しきい値を超えるまで回転を始めない */
    pending: boolean
    startX: number
    startY: number
  } | null>(null)
  const euler = useRef(new THREE.Euler(0, 0, 0, 'YXZ'))

  useEffect(() => {
    camera.position.set(7, 5, 9)
    camera.lookAt(0, 0.5, 0)
  }, [resetStamp, camera])

  useEffect(() => {
    const el = gl.domElement

    const blocked = () =>
      useStore.getState().mode === 'preview' || useStore.getState().transformDragging

    const raycaster = new THREE.Raycaster()
    const ndc = new THREE.Vector2()

    /** 左クリック位置にオブジェクト or ライトプロキシがあるか */
    const hitsObject = (e: PointerEvent) => {
      const rect = el.getBoundingClientRect()
      ndc.set(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1,
      )
      raycaster.setFromCamera(ndc, camera)
      const targets = Array.from(runtime.objects.values()).filter((o) => o.visible)
      return raycaster.intersectObjects(targets, true).length > 0
    }

    const startDrag = (e: PointerEvent, pending: boolean) => {
      drag.current = {
        button: e.button,
        x: e.clientX,
        y: e.clientY,
        pending,
        startX: e.clientX,
        startY: e.clientY,
      }
      try {
        el.setPointerCapture(e.pointerId)
      } catch {
        /* 合成イベントなどで capture できなくても操作は続行できる */
      }
    }

    const onPointerDown = (e: PointerEvent) => {
      if (blocked()) return
      if (e.button === 2 || e.button === 1) {
        e.preventDefault()
        startDrag(e, false)
        return
      }
      if (e.button === 0) {
        // ギズモ操作中・オブジェクト上では選択系の操作を優先する
        if (runtime.gizmo?.axis) return
        if (hitsObject(e)) return
        startDrag(e, true)
      }
    }
    const onPointerMove = (e: PointerEvent) => {
      if (!drag.current || blocked()) return
      if (drag.current.pending) {
        const total = Math.hypot(
          e.clientX - drag.current.startX,
          e.clientY - drag.current.startY,
        )
        if (total < 4) return
        drag.current.pending = false
        drag.current.x = e.clientX
        drag.current.y = e.clientY
        runtime.suppressMissed = true
        return
      }
      const dx = e.clientX - drag.current.x
      const dy = e.clientY - drag.current.y
      drag.current.x = e.clientX
      drag.current.y = e.clientY
      if (drag.current.button === 2 || drag.current.button === 0) {
        euler.current.setFromQuaternion(camera.quaternion)
        euler.current.y -= dx * 0.0045
        euler.current.x = THREE.MathUtils.clamp(euler.current.x - dy * 0.0045, -1.55, 1.55)
        euler.current.z = 0
        camera.quaternion.setFromEuler(euler.current)
      } else {
        const pan = new THREE.Vector3(-dx * 0.012, dy * 0.012, 0).applyQuaternion(
          camera.quaternion,
        )
        camera.position.add(pan)
      }
    }
    const onPointerUp = (e: PointerEvent) => {
      drag.current = null
      if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId)
      // click (onPointerMissed) はこの後に発火するので、少し遅らせて解除する
      setTimeout(() => {
        runtime.suppressMissed = false
      }, 80)
    }
    const onWheel = (e: WheelEvent) => {
      if (blocked()) return
      e.preventDefault()
      const dir = new THREE.Vector3()
      camera.getWorldDirection(dir)
      camera.position.addScaledVector(dir, -e.deltaY * 0.012)
    }
    const onContextMenu = (e: MouseEvent) => e.preventDefault()

    el.addEventListener('pointerdown', onPointerDown)
    el.addEventListener('pointermove', onPointerMove)
    el.addEventListener('pointerup', onPointerUp)
    el.addEventListener('wheel', onWheel, { passive: false })
    el.addEventListener('contextmenu', onContextMenu)
    return () => {
      el.removeEventListener('pointerdown', onPointerDown)
      el.removeEventListener('pointermove', onPointerMove)
      el.removeEventListener('pointerup', onPointerUp)
      el.removeEventListener('wheel', onWheel)
      el.removeEventListener('contextmenu', onContextMenu)
    }
  }, [gl, camera])

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      // Cmd/Ctrl ショートカット (Undo 等) を移動キーとして拾わない。
      // ただし Ctrl 単押しは下降キーとして許可する
      if (e.metaKey) return
      if (e.ctrlKey && e.code !== 'ControlLeft' && e.code !== 'ControlRight') return
      if (!isTyping()) keys.current.add(e.code)
    }
    const up = (e: KeyboardEvent) => keys.current.delete(e.code)
    const clear = () => keys.current.clear()
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    window.addEventListener('blur', clear)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
      window.removeEventListener('blur', clear)
    }
  }, [])

  useFrame((_, dt) => {
    const s = useStore.getState()
    if (s.mode === 'preview' || s.transformDragging) return
    const k = keys.current
    if (!k.size) return
    const speed = (k.has('ShiftLeft') || k.has('ShiftRight') ? 12 : 4) * Math.min(dt, 0.05)
    const forward = new THREE.Vector3()
    camera.getWorldDirection(forward)
    const right = new THREE.Vector3().crossVectors(forward, camera.up).normalize()
    if (k.has('KeyW')) camera.position.addScaledVector(forward, speed)
    if (k.has('KeyS')) camera.position.addScaledVector(forward, -speed)
    if (k.has('KeyA')) camera.position.addScaledVector(right, -speed)
    if (k.has('KeyD')) camera.position.addScaledVector(right, speed)
    if (k.has('Space')) camera.position.y += speed
    if (k.has('KeyZ') || k.has('KeyX') || k.has('ControlLeft') || k.has('ControlRight'))
      camera.position.y -= speed
  })

  return null
}
