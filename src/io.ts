import { saveShow } from './db'
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

export function toggleRecording() {
  const state = useStore.getState()
  if (recorder) {
    recorder.stop()
    return
  }
  const canvas = runtime.canvas
  if (!canvas) return
  const stream = canvas.captureStream(60)
  const mime = MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
    ? 'video/webm;codecs=vp9'
    : 'video/webm'
  chunks = []
  recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 12_000_000 })
  recorder.ondataavailable = (e) => {
    if (e.data.size) chunks.push(e.data)
  }
  recorder.onstop = () => {
    downloadBlob(new Blob(chunks, { type: 'video/webm' }), `${useStore.getState().sceneName}.webm`)
    recorder = null
    useStore.getState().setRecording(false)
    useStore.getState().flash('WebM を保存しました')
  }
  recorder.start()
  state.setRecording(true)
  state.flash('録画中… もう一度押すと停止します')
}

export function publishToLocalViewer() {
  const s = useStore.getState()
  if (!s.shots.length) {
    s.flash('先に Shot を保存してください (R)')
    return
  }
  const suggested = s.sceneName.replace(/[^\w-]/g, '-').toLowerCase()
  const slug = window.prompt('公開 slug を入力してください', suggested)
  if (!slug) return
  saveShow(slug, s.serialize())
    .then(() => {
      const url = `${window.location.origin}${window.location.pathname}?showcase=${encodeURIComponent(slug)}`
      navigator.clipboard?.writeText(url).catch(() => {})
      useStore.getState().flash(`Viewer URL をコピーしました: ${url}`)
    })
    .catch(() => {
      useStore.getState().flash('Publish に失敗しました (ストレージ書き込みエラー)')
    })
}
