import { runtime, useStore } from './store'
import type { SceneFile } from './types'

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

export function saveSceneJson() {
  const s = useStore.getState()
  const file = s.serialize()
  downloadBlob(
    new Blob([JSON.stringify(file, null, 2)], { type: 'application/json' }),
    `${s.sceneName}.scene.json`,
  )
  s.flash('Scene JSON を保存しました')
}

export function pickFile(accept: string, onPick: (file: File) => void) {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = accept
  input.onchange = () => {
    const f = input.files?.[0]
    if (f) onPick(f)
  }
  input.click()
}

export function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

export function imageAspect(dataUrl: string): Promise<number> {
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => resolve(img.naturalWidth / img.naturalHeight || 1)
    img.onerror = () => resolve(1)
    img.src = dataUrl
  })
}

export function openSceneJson() {
  pickFile('.json,application/json', async (f) => {
    try {
      const file = JSON.parse(await f.text()) as SceneFile
      if (file.version !== 1 && file.version !== 2) throw new Error('unsupported version')
      useStore.getState().loadScene(file)
    } catch {
      useStore.getState().flash('Scene JSON の読み込みに失敗しました')
    }
  })
}

export function savePng() {
  const canvas = runtime.canvas
  if (!canvas) return
  const name = useStore.getState().sceneName
  canvas.toBlob((blob) => {
    if (blob) downloadBlob(blob, `${name}.png`)
  }, 'image/png')
  useStore.getState().flash('PNG を保存しました')
}

let recorder: MediaRecorder | null = null
let chunks: Blob[] = []

/**
 * SNS (X / Instagram 等) にそのまま上げられるよう MP4 (H.264) を優先し、
 * 非対応ブラウザでは WebM にフォールバックする
 */
function pickRecordingFormat(): { mime: string; ext: string } {
  const candidates = [
    'video/mp4;codecs=avc1.42E01E',
    'video/mp4',
    'video/webm;codecs=vp9',
    'video/webm',
  ]
  const mime = candidates.find((m) => MediaRecorder.isTypeSupported(m)) ?? 'video/webm'
  return { mime, ext: mime.startsWith('video/mp4') ? 'mp4' : 'webm' }
}

/**
 * 動きループの短いクリップ (既定5秒) を MP4 で書き出す。公開時に「ポスト添付用」として使う。
 * 呼び出し側で Preview にして動きを再生してから呼ぶこと。手動録画(toggleRecording)とは独立。
 */
export function recordCanvasClip(seconds = 5): Promise<void> {
  return new Promise((resolve) => {
    const canvas = runtime.canvas
    if (!canvas) {
      resolve()
      return
    }
    const stream = canvas.captureStream(60)
    const { mime, ext } = pickRecordingFormat()
    const localChunks: Blob[] = []
    const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 12_000_000 })
    rec.ondataavailable = (e) => {
      if (e.data.size) localChunks.push(e.data)
    }
    rec.onstop = () => {
      downloadBlob(
        new Blob(localChunks, { type: mime.split(';')[0] }),
        `${useStore.getState().sceneName}.loop.${ext}`,
      )
      useStore.getState().flash(`${ext.toUpperCase()} (${seconds}秒) を保存しました`)
      resolve()
    }
    rec.start()
    useStore.getState().flash(`動画を生成中… (${seconds}秒)`)
    setTimeout(() => rec.stop(), seconds * 1000)
  })
}

export function toggleRecording() {
  const state = useStore.getState()
  if (recorder) {
    recorder.stop()
    return
  }
  const canvas = runtime.canvas
  if (!canvas) return
  const stream = canvas.captureStream(60)
  const { mime, ext } = pickRecordingFormat()
  chunks = []
  recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 12_000_000 })
  recorder.ondataavailable = (e) => {
    if (e.data.size) chunks.push(e.data)
  }
  recorder.onstop = () => {
    downloadBlob(
      new Blob(chunks, { type: mime.split(';')[0] }),
      `${useStore.getState().sceneName}.${ext}`,
    )
    recorder = null
    useStore.getState().setRecording(false)
    useStore.getState().flash(`${ext.toUpperCase()} を保存しました`)
  }
  recorder.start()
  state.setRecording(true)
  state.flash(`録画中 (${ext.toUpperCase()})… もう一度押すと停止します`)
}
