import { useEffect, useRef, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'

interface GifState {
  frames: ImageBitmap[]
  durations: number[]
  canvas: HTMLCanvasElement
  ctx: CanvasRenderingContext2D
  texture: THREE.CanvasTexture
  idx: number
  acc: number
}

type ImageDecoderLike = new (init: { data: ArrayBuffer; type: string }) => {
  tracks: { ready: Promise<void>; selectedTrack?: { frameCount: number } }
  decode: (o: { frameIndex: number }) => Promise<{ image: VideoFrame }>
  close?: () => void
}

/**
 * GIF の dataURL / https URL を全フレームデコードしてループ再生する CanvasTexture を返す。
 * GIF でない・ImageDecoder 非対応なら null(呼び出し側は静止テクスチャにフォールバック)。
 * 先頭バイト(GIF マジック)で判定するため、クラウド公開の URL でも動く。
 */
export function useGifTexture(url: string | undefined): THREE.CanvasTexture | null {
  const [tex, setTex] = useState<THREE.CanvasTexture | null>(null)
  const ref = useRef<GifState | null>(null)

  useEffect(() => {
    const Decoder = (globalThis as { ImageDecoder?: ImageDecoderLike }).ImageDecoder
    if (!url || !Decoder) {
      setTex(null)
      return
    }
    let alive = true
    void (async () => {
      try {
        const buf = await (await fetch(url)).arrayBuffer()
        const head = new Uint8Array(buf, 0, Math.min(4, buf.byteLength))
        // 'GIF8' (GIF87a / GIF89a)
        const isGif = head[0] === 0x47 && head[1] === 0x49 && head[2] === 0x46 && head[3] === 0x38
        if (!isGif) {
          if (alive) setTex(null)
          return
        }
        const decoder = new Decoder({ data: buf, type: 'image/gif' })
        await decoder.tracks.ready
        const count = decoder.tracks.selectedTrack?.frameCount ?? 1
        const frames: ImageBitmap[] = []
        const durations: number[] = []
        for (let i = 0; i < count; i++) {
          const { image } = await decoder.decode({ frameIndex: i })
          frames.push(await createImageBitmap(image))
          const ms = (image.duration ?? 100_000) / 1000
          durations.push(ms < 20 ? 100 : ms) // 極端に短い遅延はブラウザ慣習で 100ms に
          image.close()
        }
        decoder.close?.()
        if (!alive || frames.length === 0) {
          frames.forEach((f) => f.close())
          return
        }
        const canvas = document.createElement('canvas')
        canvas.width = frames[0].width
        canvas.height = frames[0].height
        const ctx = canvas.getContext('2d')!
        ctx.drawImage(frames[0], 0, 0)
        const texture = new THREE.CanvasTexture(canvas)
        texture.colorSpace = THREE.SRGBColorSpace
        ref.current = { frames, durations, canvas, ctx, texture, idx: 0, acc: 0 }
        setTex(texture)
      } catch {
        if (alive) setTex(null)
      }
    })()
    return () => {
      alive = false
      const st = ref.current
      if (st) {
        st.frames.forEach((f) => f.close())
        st.texture.dispose()
      }
      ref.current = null
    }
  }, [url])

  useFrame((_, dt) => {
    const st = ref.current
    if (!st || st.frames.length < 2) return
    st.acc += dt * 1000
    let changed = false
    let dur = st.durations[st.idx] || 100
    while (st.acc >= dur) {
      st.acc -= dur
      st.idx = (st.idx + 1) % st.frames.length
      dur = st.durations[st.idx] || 100
      changed = true
    }
    if (changed) {
      st.ctx.clearRect(0, 0, st.canvas.width, st.canvas.height)
      st.ctx.drawImage(st.frames[st.idx], 0, 0)
      st.texture.needsUpdate = true
    }
  })

  return tex
}
