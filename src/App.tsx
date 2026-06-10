import { useEffect } from 'react'
import {
  openSceneJson,
  publishToLocalViewer,
  savePng,
  saveSceneJson,
  toggleRecording,
} from './io'
import { CameraPanel, EditPanel, FxPanel, LightPanel, ObjectPanel, ScenePanel } from './panels'
import { Viewport } from './scene/Viewport'
import { aspectToNumber, focalToFov, fovToFocal, useStore } from './store'
import type { Mode, Tab } from './types'

const TABS: { id: Tab; label: string }[] = [
  { id: 'edit', label: 'Edit' },
  { id: 'scene', label: 'Scene' },
  { id: 'camera', label: 'Camera' },
  { id: 'object', label: 'Object' },
  { id: 'light', label: 'Light' },
  { id: 'fx', label: 'FX' },
]

const MODE_LABEL: Record<Mode, string> = {
  edit: 'Edit',
  camera: 'Camera',
  preview: 'Preview',
}

function isTyping() {
  const el = document.activeElement
  return (
    el instanceof HTMLInputElement ||
    el instanceof HTMLTextAreaElement ||
    el instanceof HTMLSelectElement
  )
}

function useHotkeys() {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const s = useStore.getState()
      if ((e.metaKey || e.ctrlKey) && e.code === 'KeyS') {
        e.preventDefault()
        if (!s.viewerLocked) saveSceneJson()
        return
      }
      if (isTyping()) return
      if (s.viewerLocked) {
        if (e.code === 'KeyI') s.toggleHelp()
        return
      }
      if ((e.metaKey || e.ctrlKey) && e.code === 'KeyZ') {
        e.preventDefault()
        if (e.shiftKey) s.redo()
        else s.undo()
        return
      }
      if (e.ctrlKey && e.code === 'KeyY') {
        e.preventDefault()
        s.redo()
        return
      }
      if (e.metaKey || e.ctrlKey) return
      switch (e.code) {
        case 'Escape':
          s.setMode(s.mode === 'edit' ? 'camera' : 'edit')
          break
        case 'KeyR':
          s.saveShot()
          break
        case 'KeyP':
          s.setMode(s.mode === 'preview' ? 'camera' : 'preview')
          break
        case 'KeyF':
          s.setMode('camera')
          break
        case 'KeyC':
          if (s.mode === 'edit') s.cycleSelection()
          break
        case 'KeyI':
          s.toggleHelp()
          break
        case 'Digit1':
          s.setTransformMode('translate')
          break
        case 'Digit2':
          s.setTransformMode('rotate')
          break
        case 'Digit3':
          s.setTransformMode('scale')
          break
        case 'Home':
          if (s.mode === 'edit') s.resetView()
          break
        case 'Delete':
        case 'Backspace':
          if (s.mode === 'edit') s.deleteSelected()
          break
        case 'ArrowLeft':
          e.preventDefault()
          s.setCamera({ focalLength: Math.max(12, s.camera.focalLength - 2) })
          break
        case 'ArrowRight':
          e.preventDefault()
          s.setCamera({ focalLength: Math.min(200, s.camera.focalLength + 2) })
          break
        case 'ArrowUp':
          e.preventDefault()
          s.setCamera({ exposure: Math.min(3, s.camera.exposure + 0.05) })
          break
        case 'ArrowDown':
          e.preventDefault()
          s.setCamera({ exposure: Math.max(0.1, s.camera.exposure - 0.05) })
          break
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])
}

/** キャンバス外周のクイック操作: 左=FOV / 右=Exposure / 下=Aperture */
function QuickSliders() {
  const cam = useStore((s) => s.camera)
  const setCamera = useStore((s) => s.setCamera)
  const fov = focalToFov(cam.focalLength)

  return (
    <>
      <div className="edge edge-left" title="FOV">
        <span className="edge-label">FOV {Math.round(fov)}°</span>
        <input
          type="range"
          min={10}
          max={90}
          step={1}
          value={fov}
          onChange={(e) => setCamera({ focalLength: fovToFocal(Number(e.target.value)) })}
        />
      </div>
      <div className="edge edge-right" title="Exposure">
        <span className="edge-label">EXP {cam.exposure.toFixed(2)}</span>
        <input
          type="range"
          min={0.1}
          max={3}
          step={0.05}
          value={cam.exposure}
          onChange={(e) => setCamera({ exposure: Number(e.target.value) })}
        />
      </div>
      <div className="edge edge-bottom" title="Aperture">
        <span className="edge-label">f/{cam.aperture.toFixed(1)}</span>
        <input
          type="range"
          min={1.2}
          max={22}
          step={0.1}
          value={cam.aperture}
          onChange={(e) => setCamera({ aperture: Number(e.target.value) })}
        />
      </div>
    </>
  )
}

function HelpOverlay() {
  const visible = useStore((s) => s.helpVisible)
  if (!visible) return null
  return (
    <div className="help-overlay" onClick={() => useStore.getState().toggleHelp()}>
      <div className="help-card">
        <h3>操作ガイド</h3>
        <ul>
          <li><b>ESC</b> Edit / Camera 切替、<b>F</b> Camera へ</li>
          <li><b>R</b> Save Shot、<b>P</b> Preview 切替</li>
          <li><b>右ドラッグ</b> 視点、<b>中ドラッグ</b> 平行移動、<b>ホイール</b> 前後</li>
          <li><b>WASD</b> 移動、<b>Space</b> 上昇、<b>Z / X / Ctrl</b> 下降、<b>Shift</b> 高速</li>
          <li><b>1 / 2 / 3</b> Move / Rotate / Scale、<b>C</b> 次を選択</li>
          <li><b>矢印キー</b> 左右: FOV、上下: 露出</li>
          <li><b>Home</b> 視点リセット、<b>Delete</b> 削除</li>
          <li><b>Cmd/Ctrl + Z</b> Undo、<b>Shift + Cmd/Ctrl + Z</b> / <b>Ctrl + Y</b> Redo</li>
          <li><b>Cmd/Ctrl + S</b> Scene JSON 保存、<b>I</b> このガイド</li>
        </ul>
      </div>
    </div>
  )
}

function Footer() {
  const mode = useStore((s) => s.mode)
  const selected = useStore((s) => s.selected)
  const objects = useStore((s) => s.objects)
  const lights = useStore((s) => s.lights)
  const shots = useStore((s) => s.shots)
  const statusMessage = useStore((s) => s.statusMessage)
  const recording = useStore((s) => s.recording)
  const transformMode = useStore((s) => s.transformMode)
  const canUndo = useStore((s) => s.canUndo)
  const canRedo = useStore((s) => s.canRedo)
  const s = useStore.getState

  const selectedName = selected
    ? selected.type === 'object'
      ? objects.find((o) => o.id === selected.id)?.name
      : lights.find((l) => l.id === selected.id)?.name
    : null

  return (
    <footer className="footer">
      <div className="footer-group">
        {(['edit', 'camera', 'preview'] as Mode[]).map((m) => (
          <button key={m} className={mode === m ? 'active' : ''} onClick={() => s().setMode(m)}>
            {MODE_LABEL[m]}
          </button>
        ))}
      </div>
      <div className="footer-group">
        <button disabled={!canUndo} onClick={() => s().undo()}>
          ↩ Undo
        </button>
        <button disabled={!canRedo} onClick={() => s().redo()}>
          ↪ Redo
        </button>
      </div>
      <div className="footer-group">
        <button onClick={() => s().saveShot()}>Save Shot</button>
        <button onClick={saveSceneJson}>Save Scene</button>
        <button onClick={openSceneJson}>Load Scene</button>
        <button onClick={savePng}>PNG</button>
        <button className={recording ? 'recording' : ''} onClick={toggleRecording}>
          {recording ? '■ 停止' : '● WebM'}
        </button>
        <button onClick={publishToLocalViewer}>Publish</button>
      </div>
      <div className="footer-status">
        {statusMessage ? (
          <span className="flash">{statusMessage}</span>
        ) : (
          <span>
            {selectedName ? `選択: ${selectedName} (${transformMode})` : '未選択'} / Shots:{' '}
            {shots.length} / I でヘルプ
          </span>
        )}
      </div>
    </footer>
  )
}

function ViewerBar() {
  const sceneName = useStore((s) => s.sceneName)
  return (
    <div className="viewer-bar">
      <span className="brand">Pixel Showcase</span>
      <span className="viewer-title">{sceneName}</span>
      <button onClick={savePng}>PNG</button>
    </div>
  )
}

export default function App() {
  useHotkeys()
  const mode = useStore((s) => s.mode)
  const tab = useStore((s) => s.tab)
  const viewerLocked = useStore((s) => s.viewerLocked)
  const aspect = useStore((s) => s.camera.aspect)
  const setTab = useStore((s) => s.setTab)

  const framed = mode !== 'edit'

  if (viewerLocked) {
    return (
      <div className="app viewer-locked">
        <ViewerBar />
        <div className="stage-wrap">
          <div className="stage framed" style={{ aspectRatio: aspectToNumber(aspect) }}>
            <Viewport />
          </div>
        </div>
        <HelpOverlay />
      </div>
    )
  }

  return (
    <div className="app">
      <header className="topbar">
        <span className="brand">Pixel Showcase Engine</span>
        <nav className="tabs">
          {TABS.map((t) => (
            <button key={t.id} className={tab === t.id ? 'active' : ''} onClick={() => setTab(t.id)}>
              {t.label}
            </button>
          ))}
        </nav>
        <span className={`mode-indicator mode-${mode}`}>{MODE_LABEL[mode]} Mode</span>
      </header>
      <div className="main">
        <div className="stage-wrap">
          <div
            className={framed ? 'stage framed' : 'stage'}
            style={framed ? { aspectRatio: aspectToNumber(aspect) } : undefined}
          >
            <Viewport />
            {framed && <div className="frame-guide" />}
          </div>
          {mode !== 'preview' && <QuickSliders />}
        </div>
        <aside className="side-panel">
          {tab === 'edit' && <EditPanel />}
          {tab === 'scene' && <ScenePanel />}
          {tab === 'camera' && <CameraPanel />}
          {tab === 'object' && <ObjectPanel />}
          {tab === 'light' && <LightPanel />}
          {tab === 'fx' && <FxPanel />}
        </aside>
      </div>
      <Footer />
      <HelpOverlay />
    </div>
  )
}
