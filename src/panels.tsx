import type { ReactNode } from 'react'
import { fileToDataUrl, imageAspect, pickFile } from './io'
import { resetCameraRoll } from './scene/FlyControls'
import { EFFECT_LABELS, focalToFov, fovToFocal, useStore } from './store'
import type { AspectRatio, EffectKind, FocusMode, LightKind, Vec3 } from './types'

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="row">
      <span className="row-label">{label}</span>
      <div className="row-body">{children}</div>
    </div>
  )
}

function SliderRow(props: {
  label: string
  value: number
  min: number
  max: number
  step?: number
  format?: (v: number) => string
  onChange: (v: number) => void
}) {
  const { label, value, min, max, step = 0.01, format, onChange } = props
  return (
    <Row label={label}>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <span className="row-value">{format ? format(value) : value.toFixed(2)}</span>
    </Row>
  )
}

function ColorRow({
  label,
  value,
  onChange,
}: {
  label: string
  value: string
  onChange: (v: string) => void
}) {
  return (
    <Row label={label}>
      <input type="color" value={value} onChange={(e) => onChange(e.target.value)} />
      <span className="row-value">{value}</span>
    </Row>
  )
}

function ToggleRow({
  label,
  value,
  onChange,
}: {
  label: string
  value: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <Row label={label}>
      <input type="checkbox" checked={value} onChange={(e) => onChange(e.target.checked)} />
    </Row>
  )
}

function Vec3Row({
  label,
  value,
  step = 0.1,
  onChange,
}: {
  label: string
  value: Vec3
  step?: number
  onChange: (v: Vec3) => void
}) {
  return (
    <Row label={label}>
      {([0, 1, 2] as const).map((i) => (
        <input
          key={i}
          className="num"
          type="number"
          step={step}
          value={Number(value[i].toFixed(3))}
          onChange={(e) => {
            const next: Vec3 = [...value]
            next[i] = Number(e.target.value)
            onChange(next)
          }}
        />
      ))}
    </Row>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="section">
      <div className="section-title">{title}</div>
      {children}
    </div>
  )
}

function Empty({ text }: { text: string }) {
  return <div className="empty">{text}</div>
}

export function EditPanel() {
  const objects = useStore((s) => s.objects)
  const selected = useStore((s) => s.selected)
  const s = useStore.getState

  const importGlb = () =>
    pickFile('.glb,.gltf,model/gltf-binary', async (f) => {
      const url = await fileToDataUrl(f)
      const assetId = await s().registerAsset(url)
      s().addGlb(assetId, f.name.replace(/\.(glb|gltf)$/i, ''))
    })

  const importImagePlane = () =>
    pickFile('image/*', async (f) => {
      const url = await fileToDataUrl(f)
      const aspect = await imageAspect(url)
      const assetId = await s().registerAsset(url)
      s().addPlane(assetId, aspect, f.name.replace(/\.\w+$/, ''))
    })

  return (
    <>
      <Section title="Add">
        <div className="btn-grid">
          <button onClick={() => s().addCube()}>+ Cube</button>
          <button onClick={() => s().addPlane()}>+ Plane</button>
          <button onClick={importImagePlane}>+ 画像プレート</button>
          <button onClick={importGlb}>+ GLB / GLTF</button>
        </div>
      </Section>
      <Section title={`Objects (${objects.length})`}>
        {objects.length === 0 && <Empty text="オブジェクトがありません。Add から追加してください。" />}
        <ul className="item-list">
          {objects.map((o) => (
            <li
              key={o.id}
              className={selected?.id === o.id ? 'active' : ''}
              onClick={() => s().select({ type: 'object', id: o.id })}
            >
              <span>{o.name}</span>
              <span className="kind">{o.kind}</span>
            </li>
          ))}
        </ul>
      </Section>
      <Section title="Hint">
        <Empty text="左クリックで選択、1/2/3 で Move / Rotate / Scale。右ドラッグで視点、WASD で移動。" />
      </Section>
    </>
  )
}

export function ScenePanel() {
  const env = useStore((s) => s.env)
  const sceneName = useStore((s) => s.sceneName)
  const setEnv = useStore((s) => s.setEnv)
  const setSceneName = useStore((s) => s.setSceneName)
  const applyHd2dLook = useStore((s) => s.applyHd2dLook)

  return (
    <>
      <Section title="Look Preset">
        <button className="wide" onClick={applyHd2dLook}>
          HD-2D風に調整
        </button>
        <Empty text="浅いDOF・ブルーム・フォグ・周辺減光・暖色キーライトをまとめて適用します。Cmd/Ctrl+Z で元に戻せます。" />
      </Section>
      <Section title="Scene">
        <Row label="Name">
          <input
            className="text"
            value={sceneName}
            onChange={(e) => setSceneName(e.target.value)}
          />
        </Row>
        <ColorRow label="背景色" value={env.backgroundColor} onChange={(v) => setEnv({ backgroundColor: v })} />
        <ToggleRow label="Grid" value={env.gridVisible} onChange={(v) => setEnv({ gridVisible: v })} />
        <ToggleRow label="地面" value={env.groundVisible} onChange={(v) => setEnv({ groundVisible: v })} />
        <ColorRow label="地面色" value={env.groundColor} onChange={(v) => setEnv({ groundColor: v })} />
      </Section>
      <Section title="Ambient">
        <ColorRow label="色" value={env.ambientColor} onChange={(v) => setEnv({ ambientColor: v })} />
        <SliderRow label="強さ" value={env.ambientIntensity} min={0} max={3} onChange={(v) => setEnv({ ambientIntensity: v })} />
      </Section>
      <Section title="Fog">
        <ToggleRow label="有効" value={env.fogEnabled} onChange={(v) => setEnv({ fogEnabled: v })} />
        <ColorRow label="色" value={env.fogColor} onChange={(v) => setEnv({ fogColor: v })} />
        <SliderRow label="開始" value={env.fogNear} min={1} max={100} step={1} format={(v) => `${v}m`} onChange={(v) => setEnv({ fogNear: v })} />
        <SliderRow label="終了" value={env.fogFar} min={5} max={200} step={1} format={(v) => `${v}m`} onChange={(v) => setEnv({ fogFar: v })} />
      </Section>
      <Section title="Bloom / Vignette">
        <ToggleRow label="Bloom" value={env.bloomEnabled} onChange={(v) => setEnv({ bloomEnabled: v })} />
        <SliderRow label="強さ" value={env.bloomIntensity} min={0} max={3} onChange={(v) => setEnv({ bloomIntensity: v })} />
        <ToggleRow label="周辺減光" value={env.vignetteEnabled} onChange={(v) => setEnv({ vignetteEnabled: v })} />
        <SliderRow label="濃さ" value={env.vignetteDarkness} min={0} max={1} onChange={(v) => setEnv({ vignetteDarkness: v })} />
      </Section>
    </>
  )
}

export function CameraPanel() {
  const cam = useStore((s) => s.camera)
  const shots = useStore((s) => s.shots)
  const activeShotId = useStore((s) => s.activeShotId)
  const thumbnails = useStore((s) => s.shotThumbnails)
  const setCamera = useStore((s) => s.setCamera)
  const moveSpeed = useStore((s) => s.moveSpeed)
  const lookSensitivity = useStore((s) => s.lookSensitivity)
  const setMoveSpeed = useStore((s) => s.setMoveSpeed)
  const setLookSensitivity = useStore((s) => s.setLookSensitivity)
  const s = useStore.getState

  return (
    <>
      <Section title="レンズ">
        <SliderRow
          label="焦点距離"
          value={cam.focalLength}
          min={12}
          max={200}
          step={1}
          format={(v) => `${Math.round(v)}mm (${Math.round(focalToFov(v))}°)`}
          onChange={(v) => setCamera({ focalLength: v })}
        />
        <SliderRow
          label="絞り"
          value={cam.aperture}
          min={1.2}
          max={22}
          step={0.1}
          format={(v) => `f/${v.toFixed(1)}`}
          onChange={(v) => setCamera({ aperture: v })}
        />
        <SliderRow
          label="露出"
          value={cam.exposure}
          min={0.1}
          max={3}
          step={0.05}
          onChange={(v) => setCamera({ exposure: v })}
        />
        <Row label="フレーム比">
          <select
            value={cam.aspect}
            onChange={(e) => setCamera({ aspect: e.target.value as AspectRatio })}
          >
            <option value="16:9">16:9</option>
            <option value="4:3">4:3</option>
            <option value="1:1">1:1</option>
          </select>
        </Row>
      </Section>
      <Section title="カメラワーク">
        <SliderRow
          label="移動速度"
          value={moveSpeed}
          min={0.5}
          max={20}
          step={0.5}
          format={(v) => `${v.toFixed(1)}m/s`}
          onChange={setMoveSpeed}
        />
        <SliderRow
          label="視点感度"
          value={lookSensitivity}
          min={0.2}
          max={3}
          step={0.05}
          format={(v) => `x${v.toFixed(2)}`}
          onChange={setLookSensitivity}
        />
        <button className="wide" onClick={resetCameraRoll}>
          ロールを水平に戻す
        </button>
        <Empty text="右ドラッグ: パン / チルト、Q / E: ロール、ホイール・W / S: ドリー、中ドラッグ: トラック / ペデスタル、Shift: 3倍速。" />
      </Section>
      <Section title="ボケ (DOF)">
        <ToggleRow label="有効" value={cam.dofEnabled} onChange={(v) => setCamera({ dofEnabled: v })} />
        <Row label="フォーカス">
          <select
            value={cam.focusMode}
            onChange={(e) => setCamera({ focusMode: e.target.value as FocusMode })}
          >
            <option value="subject">Subject(選択中)</option>
            <option value="manual">Manual(距離指定)</option>
            <option value="screenPoint">Screen Point(クリック)</option>
          </select>
        </Row>
        {cam.focusMode === 'manual' && (
          <SliderRow
            label="距離"
            value={cam.manualFocusDistance}
            min={0.5}
            max={60}
            step={0.5}
            format={(v) => `${v.toFixed(1)}m`}
            onChange={(v) => setCamera({ manualFocusDistance: v })}
          />
        )}
        {cam.focusMode === 'screenPoint' && (
          <Empty text="Camera モード中にキャンバスをクリックするとピント位置が決まります。" />
        )}
      </Section>
      <Section title={`Shots (${shots.length})`}>
        <button className="wide" onClick={() => s().saveShot()}>
          Save Shot (R)
        </button>
        {shots.length === 0 && <Empty text="まだ Shot がありません。構図を決めて R で保存します。" />}
        <ul className="item-list shot-list">
          {shots.map((shot) => (
            <li
              key={shot.id}
              className={activeShotId === shot.id ? 'active' : ''}
              onClick={() => s().applyShot(shot.id)}
            >
              {thumbnails[shot.id] ? (
                <img className="shot-thumb" src={thumbnails[shot.id]} alt="" />
              ) : (
                <span className="shot-thumb placeholder" />
              )}
              <span className="shot-name">{shot.name}</span>
              <button
                className="mini"
                onClick={(e) => {
                  e.stopPropagation()
                  s().deleteShot(shot.id)
                }}
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      </Section>
    </>
  )
}

export function ObjectPanel() {
  const selected = useStore((s) => s.selected)
  const objects = useStore((s) => s.objects)
  const s = useStore.getState
  const obj = selected?.type === 'object' ? objects.find((o) => o.id === selected.id) : undefined

  if (!obj) {
    return <Empty text="オブジェクトが未選択です。キャンバスでクリックするか C で選択してください。" />
  }

  const uniform = obj.scale[0]

  const setImage = () =>
    pickFile('image/*', async (f) => {
      const url = await fileToDataUrl(f)
      const assetId = await s().registerAsset(url)
      s().updateMaterial(obj.id, { textureAssetId: assetId })
    })

  return (
    <>
      <Section title="Object">
        <Row label="Name">
          <input
            className="text"
            value={obj.name}
            onChange={(e) => s().updateObject(obj.id, { name: e.target.value })}
          />
        </Row>
        <Vec3Row label="位置" value={obj.position} onChange={(v) => s().updateObject(obj.id, { position: v })} />
        <Vec3Row label="回転" value={obj.rotation} step={0.05} onChange={(v) => s().updateObject(obj.id, { rotation: v })} />
        <Vec3Row label="拡縮" value={obj.scale} onChange={(v) => s().updateObject(obj.id, { scale: v })} />
        <Row label="均等拡縮">
          <input
            className="num"
            type="number"
            step={0.1}
            min={0.001}
            value={Number(uniform.toFixed(3))}
            onChange={(e) => {
              const v = Number(e.target.value)
              if (v > 0) s().updateObject(obj.id, { scale: [v, v, v] })
            }}
          />
        </Row>
        <div className="btn-grid">
          <button onClick={() => s().duplicateObject(obj.id)}>Duplicate</button>
          <button className="danger" onClick={() => s().removeObject(obj.id)}>
            Delete
          </button>
        </div>
      </Section>
      {obj.kind === 'glb' && (
        <Section title="Material (GLB)">
          <ToggleRow
            label="質感上書き"
            value={obj.materialOverride ?? false}
            onChange={(v) => s().updateObject(obj.id, { materialOverride: v })}
          />
          {obj.materialOverride ? (
            <>
              <SliderRow label="金属感" value={obj.material.metalness} min={0} max={1} onChange={(v) => s().updateMaterial(obj.id, { metalness: v })} />
              <SliderRow label="粗さ" value={obj.material.roughness} min={0} max={1} onChange={(v) => s().updateMaterial(obj.id, { roughness: v })} />
              <ColorRow label="発光色" value={obj.material.emissive} onChange={(v) => s().updateMaterial(obj.id, { emissive: v })} />
              <SliderRow label="発光強度" value={obj.material.emissiveIntensity} min={0} max={8} onChange={(v) => s().updateMaterial(obj.id, { emissiveIntensity: v })} />
              <ToggleRow label="ドット維持" value={obj.material.pixelated} onChange={(v) => s().updateMaterial(obj.id, { pixelated: v })} />
            </>
          ) : (
            <Empty text="オフの間は GLB 本来のマテリアルで表示します。オンにすると色は保ったまま質感(金属感 / 粗さ / 発光)だけを上書きします。" />
          )}
        </Section>
      )}
      {obj.kind !== 'glb' && (
        <Section title="Material">
          <ColorRow label="色" value={obj.material.color} onChange={(v) => s().updateMaterial(obj.id, { color: v })} />
          <SliderRow label="金属感" value={obj.material.metalness} min={0} max={1} onChange={(v) => s().updateMaterial(obj.id, { metalness: v })} />
          <SliderRow label="粗さ" value={obj.material.roughness} min={0} max={1} onChange={(v) => s().updateMaterial(obj.id, { roughness: v })} />
          <ColorRow label="発光色" value={obj.material.emissive} onChange={(v) => s().updateMaterial(obj.id, { emissive: v })} />
          <SliderRow label="発光強度" value={obj.material.emissiveIntensity} min={0} max={8} onChange={(v) => s().updateMaterial(obj.id, { emissiveIntensity: v })} />
          <ToggleRow label="ドット維持" value={obj.material.pixelated} onChange={(v) => s().updateMaterial(obj.id, { pixelated: v })} />
          <div className="btn-grid">
            <button onClick={setImage}>画像を貼る…</button>
            {obj.material.textureAssetId && (
              <button
                onClick={() => {
                  s().updateMaterial(obj.id, { textureAssetId: undefined })
                  s().pruneAssets()
                }}
              >
                画像を外す
              </button>
            )}
          </div>
        </Section>
      )}
    </>
  )
}

export function LightPanel() {
  const lights = useStore((s) => s.lights)
  const selected = useStore((s) => s.selected)
  const s = useStore.getState
  const light = selected?.type === 'light' ? lights.find((l) => l.id === selected.id) : undefined

  return (
    <>
      <Section title="Add Light">
        <div className="btn-grid">
          {(['directional', 'point', 'spot'] as LightKind[]).map((k) => (
            <button key={k} onClick={() => s().addLight(k)}>
              + {k}
            </button>
          ))}
        </div>
      </Section>
      <Section title={`Lights (${lights.length})`}>
        {lights.length === 0 && <Empty text="ライトがありません。" />}
        <ul className="item-list">
          {lights.map((l) => (
            <li
              key={l.id}
              className={selected?.id === l.id ? 'active' : ''}
              onClick={() => s().select({ type: 'light', id: l.id })}
            >
              <span>{l.name}</span>
              <span className="kind">{l.kind}</span>
            </li>
          ))}
        </ul>
      </Section>
      {light ? (
        <Section title="Light Inspector">
          <Row label="Name">
            <input
              className="text"
              value={light.name}
              onChange={(e) => s().updateLight(light.id, { name: e.target.value })}
            />
          </Row>
          <ColorRow label="色" value={light.color} onChange={(v) => s().updateLight(light.id, { color: v })} />
          <SliderRow
            label="強さ"
            value={light.intensity}
            min={0}
            max={light.kind === 'directional' ? 10 : 200}
            step={0.1}
            onChange={(v) => s().updateLight(light.id, { intensity: v })}
          />
          <Vec3Row label="位置" value={light.position} onChange={(v) => s().updateLight(light.id, { position: v })} />
          <ToggleRow label="影" value={light.castShadow} onChange={(v) => s().updateLight(light.id, { castShadow: v })} />
          <button className="wide danger" onClick={() => s().removeLight(light.id)}>
            Delete Light
          </button>
        </Section>
      ) : (
        <Empty text="ライト未選択。一覧かキャンバスのワイヤー球をクリックしてください。" />
      )}
    </>
  )
}

const FX_KINDS: EffectKind[] = [
  'sparkle',
  'mote',
  'dust',
  'flame',
  'splash',
  'electric',
  'rain',
  'wind',
]

export function FxPanel() {
  const effects = useStore((s) => s.effects)
  const selected = useStore((s) => s.selected)
  const s = useStore.getState
  const eff = selected?.type === 'effect' ? effects.find((e) => e.id === selected.id) : undefined

  return (
    <>
      <Section title="Add Effect">
        <div className="btn-grid">
          {FX_KINDS.map((k) => (
            <button key={k} onClick={() => s().addEffect(k)}>
              + {EFFECT_LABELS[k]}
            </button>
          ))}
        </div>
      </Section>
      <Section title={`Effects (${effects.length})`}>
        {effects.length === 0 && (
          <Empty text="エフェクトがありません。Add から追加すると原点付近に置かれ、ギズモで動かせます。" />
        )}
        <ul className="item-list">
          {effects.map((e) => (
            <li
              key={e.id}
              className={selected?.id === e.id ? 'active' : ''}
              onClick={() => s().select({ type: 'effect', id: e.id })}
            >
              <span>{e.name}</span>
              <span className="kind">{EFFECT_LABELS[e.kind]}</span>
            </li>
          ))}
        </ul>
      </Section>
      {eff ? (
        <Section title="Effect Inspector">
          <Row label="Name">
            <input
              className="text"
              value={eff.name}
              onChange={(e) => s().updateEffect(eff.id, { name: e.target.value })}
            />
          </Row>
          <Vec3Row label="位置" value={eff.position} onChange={(v) => s().updateEffect(eff.id, { position: v })} />
          <ColorRow label="色" value={eff.color} onChange={(v) => s().updateEffect(eff.id, { color: v })} />
          <SliderRow label="粒の量" value={eff.count} min={10} max={600} step={10} format={(v) => `${v}`} onChange={(v) => s().updateEffect(eff.id, { count: v })} />
          <SliderRow label="速さ" value={eff.speed} min={0.1} max={3} step={0.05} format={(v) => `x${v.toFixed(2)}`} onChange={(v) => s().updateEffect(eff.id, { speed: v })} />
          <SliderRow label="大きさ" value={eff.size} min={0.2} max={3} step={0.05} format={(v) => `x${v.toFixed(2)}`} onChange={(v) => s().updateEffect(eff.id, { size: v })} />
          <SliderRow label="広がり" value={eff.radius} min={0.1} max={30} step={0.1} format={(v) => `${v.toFixed(1)}m`} onChange={(v) => s().updateEffect(eff.id, { radius: v })} />
          <button className="wide danger" onClick={() => s().removeEffect(eff.id)}>
            Delete Effect
          </button>
        </Section>
      ) : (
        <Empty text="エフェクト未選択。一覧かキャンバスのワイヤーマーカーをクリックしてください。" />
      )}
    </>
  )
}

export { fovToFocal }
