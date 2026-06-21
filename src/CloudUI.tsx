import { useEffect, useState } from 'react'
import { deleteAccount } from './cloud/account'
import { listLibraryAssets, updateLibraryAsset, type LibraryAsset } from './cloud/assets'
import { signInWithGoogle, signOutCloud } from './cloud/auth'
import { issueAgentPublishToken } from './cloud/publish'
import {
  deleteCloudScene,
  listMyScenes,
  loadSceneFromCloud,
  saveSceneToCloud,
  type CloudSceneMeta,
} from './cloud/scenes'
import { imageAspect } from './io'
import { useStore } from './store'

function msgOf(e: unknown): string {
  const code = (e as { code?: string })?.code ?? ''
  if (code.includes('popup-closed') || code.includes('cancelled')) return 'サインインを中止しました'
  if (code.includes('requires-recent-login'))
    return 'セキュリティのため、一度サインアウトして再サインインしてから削除してください'
  if (code.includes('permission')) return '権限がありません (ルール未デプロイ?)'
  if (code.includes('failed-precondition'))
    return 'ライブラリにアセットがありません。先に GLB/画像を置いて ☁保存 してください'
  if (code.includes('resource-exhausted')) return '生成上限に達しました (1日20件 / シーン20件)'
  if ((e as Error)?.message === 'not-signed-in') return 'サインインが必要です'
  return (e as Error)?.message ?? 'エラーが発生しました'
}

/** 現在のシーンをクラウドへ保存 (未サインインなら先にサインイン) */
async function doCloudSave() {
  const s = useStore.getState()
  try {
    if (!s.cloudUser) await signInWithGoogle()
    const name = window.prompt('クラウドに保存する名前', s.sceneName)
    if (!name) return
    s.setCloudBusy(true)
    const id = await saveSceneToCloud(name)
    s.setCloudSceneId(id)
    s.setSceneName(name)
    s.flash('クラウドに保存しました')
  } catch (e) {
    s.flash(`クラウド保存に失敗: ${msgOf(e)}`)
  } finally {
    s.setCloudBusy(false)
  }
}

/** トップバーのアカウント表示 / サインイン・アウト / 退会 */
export function CloudAccount() {
  const cloudUser = useStore((s) => s.cloudUser)
  const cloudBusy = useStore((s) => s.cloudBusy)
  const [deleting, setDeleting] = useState(false)
  const [linking, setLinking] = useState(false)

  if (cloudUser) {
    return (
      <span className="cloud-account">
        <span className="cloud-name">{cloudUser.name ?? 'サインイン中'}</span>
        <button className="mini" disabled={cloudBusy} onClick={() => setLinking(true)}>
          連携
        </button>
        <button className="mini" disabled={cloudBusy} onClick={() => signOutCloud()}>
          サインアウト
        </button>
        <button className="mini danger" disabled={cloudBusy} onClick={() => setDeleting(true)}>
          退会
        </button>
        {linking && <AgentLinkModal uid={cloudUser.uid} onClose={() => setLinking(false)} />}
        {deleting && <DeleteAccountModal onClose={() => setDeleting(false)} />}
      </span>
    )
  }
  return (
    <button
      className="mini"
      disabled={cloudBusy}
      onClick={() => signInWithGoogle().catch((e) => useStore.getState().flash(msgOf(e)))}
    >
      サインイン
    </button>
  )
}

/** フッターのクラウド操作 (保存 / 開く / ライブラリ) + 一覧モーダル */
export function CloudBar() {
  const cloudBusy = useStore((s) => s.cloudBusy)
  const [open, setOpen] = useState(false)
  const [lib, setLib] = useState(false)

  return (
    <div className="footer-group">
      <button disabled={cloudBusy} onClick={doCloudSave}>
        ☁ 保存
      </button>
      <button disabled={cloudBusy} onClick={() => setOpen(true)}>
        ☁ 開く
      </button>
      <button disabled={cloudBusy} onClick={() => setLib(true)}>
        ☁ ライブラリ
      </button>
      {open && <CloudScenesModal onClose={() => setOpen(false)} />}
      {lib && <LibraryModal onClose={() => setLib(false)} />}
    </div>
  )
}

/** アカウントに登録済みのアセット一覧。クリックで現在のシーンに配置する。 */
function LibraryModal({ onClose }: { onClose: () => void }) {
  const [assets, setAssets] = useState<LibraryAsset[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [q, setQ] = useState('')

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        if (!useStore.getState().cloudUser) await signInWithGoogle()
        const list = await listLibraryAssets()
        if (alive) setAssets(list)
      } catch (e) {
        if (alive) setError(msgOf(e))
      }
    })()
    return () => {
      alive = false
    }
  }, [])

  const [editing, setEditing] = useState<string | null>(null)

  const place = async (a: LibraryAsset) => {
    try {
      useStore.getState().registerAssetUrl(a.hash, a.url)
      const ds = a.defaultScale && a.defaultScale > 0 ? a.defaultScale : 1
      if (a.kind === 'glb') {
        useStore.getState().addGlb(a.hash, a.name)
      } else {
        const aspect = a.aspect ?? (await imageAspect(a.url))
        useStore.getState().addPlane(a.hash, aspect, a.name)
      }
      // 既定スケール/色味を適用(直近に追加したオブジェクト)
      const st = useStore.getState()
      const obj = st.objects[st.objects.length - 1]
      if (obj) {
        if (ds !== 1) st.updateObject(obj.id, { scale: [obj.scale[0] * ds, obj.scale[1] * ds, obj.scale[2] * ds] })
        if (a.tint) {
          st.updateMaterial(obj.id, { color: a.tint })
          if (a.kind === 'glb') st.updateObject(obj.id, { materialOverride: true })
        }
      }
      useStore.getState().flash(`「${a.name}」を配置しました`)
      onClose()
    } catch (e) {
      setError(msgOf(e))
    }
  }

  const saveMeta = async (hash: string, patch: { defaultScale?: number; tint?: string; description?: string; tags?: string[] }) => {
    try {
      await updateLibraryAsset(hash, patch)
      setAssets((cur) => cur?.map((a) => (a.hash === hash ? { ...a, ...patch } : a)) ?? null)
      setEditing(null)
      useStore.getState().flash('アセット設定を保存しました')
    } catch (e) {
      setError(msgOf(e))
    }
  }

  const needle = q.trim().toLowerCase()
  const filtered =
    assets?.filter((a) => {
      if (!needle) return true
      const hay = `${a.name} ${a.kind} ${a.description ?? ''} ${(a.tags ?? []).join(' ')}`.toLowerCase()
      return hay.includes(needle)
    }) ?? null

  return (
    <div className="help-overlay" onClick={onClose}>
      <div className="help-card cloud-modal" onClick={(e) => e.stopPropagation()}>
        <h3>アセットライブラリ</h3>
        <p className="welcome-lead">
          このアカウントで保存したオブジェクトです。「配置」で今のシーンに置く / 「設定」で既定スケール・色味・
          説明(AIが参照)を編集できます。
        </p>
        {error && <div className="cloud-error">{error}</div>}
        {!assets && !error && <div className="empty">読み込み中…</div>}
        {assets && assets.length === 0 && (
          <div className="empty">まだアセットがありません。GLB/画像を置いてクラウド保存すると貯まります。</div>
        )}
        {assets && assets.length > 0 && (
          <div className="cloud-toolbar">
            <input
              className="text"
              placeholder="名前・タグ・説明で絞り込み"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            <span className="cloud-count">
              {needle ? `${filtered?.length} / ${assets.length}` : `${assets.length}`} 件
            </span>
          </div>
        )}
        <ul className="item-list">
          {filtered?.map((a) => (
            <li key={a.hash} style={{ display: 'block' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span className="shot-name" style={{ flex: 1 }}>
                  {a.name}
                </span>
                <span className="kind">{a.kind === 'glb' ? '3D' : '画像'}</span>
                <button className="mini" onClick={() => setEditing(editing === a.hash ? null : a.hash)}>
                  設定
                </button>
                <button className="mini" onClick={() => place(a)}>
                  配置
                </button>
              </div>
              {editing === a.hash && <AssetEditor asset={a} onSave={(p) => saveMeta(a.hash, p)} />}
            </li>
          ))}
          {filtered && filtered.length === 0 && assets && assets.length > 0 && (
            <li className="empty" style={{ cursor: 'default', display: 'block' }}>
              「{q}」に一致するアセットはありません
            </li>
          )}
        </ul>
        <button className="wide" onClick={onClose}>
          閉じる
        </button>
      </div>
    </div>
  )
}

/** ライブラリ1アセットの既定スケール/色味/説明/タグを編集する小フォーム */
function AssetEditor({
  asset,
  onSave,
}: {
  asset: LibraryAsset
  onSave: (patch: { defaultScale: number; tint: string; description: string; tags: string[] }) => void
}) {
  const [scale, setScale] = useState(asset.defaultScale ?? 1)
  const [tint, setTint] = useState(asset.tint ?? '#ffffff')
  const [desc, setDesc] = useState(asset.description ?? '')
  const [tags, setTags] = useState((asset.tags ?? []).join(', '))
  return (
    <div className="asset-editor">
      <div className="row">
        <span className="row-label">既定スケール</span>
        <div className="row-body">
          <input
            type="range"
            min={0.05}
            max={5}
            step={0.05}
            value={scale}
            onChange={(e) => setScale(Number(e.target.value))}
          />
          <span className="row-value">{scale.toFixed(2)}×</span>
        </div>
      </div>
      <div className="row">
        <span className="row-label">色味</span>
        <div className="row-body">
          <input type="color" value={tint} onChange={(e) => setTint(e.target.value)} />
          <span className="row-value">{tint}</span>
        </div>
      </div>
      <div className="row">
        <span className="row-label">説明(AI用)</span>
        <div className="row-body">
          <input
            className="text"
            placeholder="例: 赤い鳥居の3Dモデル"
            value={desc}
            onChange={(e) => setDesc(e.target.value)}
          />
        </div>
      </div>
      <div className="row">
        <span className="row-label">タグ</span>
        <div className="row-body">
          <input
            className="text"
            placeholder="カンマ区切り 例: 建物, 和風"
            value={tags}
            onChange={(e) => setTags(e.target.value)}
          />
        </div>
      </div>
      <button
        className="wide"
        onClick={() =>
          onSave({
            defaultScale: scale,
            tint,
            description: desc.trim(),
            tags: tags
              .split(',')
              .map((t) => t.trim())
              .filter(Boolean),
          })
        }
      >
        保存
      </button>
    </div>
  )
}

function fmtDate(ms: number): string {
  if (!ms) return ''
  const d = new Date(ms)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

function CloudScenesModal({ onClose }: { onClose: () => void }) {
  const [scenes, setScenes] = useState<CloudSceneMeta[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [q, setQ] = useState('')
  const [token, setToken] = useState<{ sceneId: string; value: string } | null>(null)
  const [copied, setCopied] = useState(false)

  const approve = async (id: string) => {
    setError(null)
    try {
      const { token: t } = await issueAgentPublishToken(id)
      setToken({ sceneId: id, value: t })
      setCopied(false)
    } catch (e) {
      setError(msgOf(e))
    }
  }

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        if (!useStore.getState().cloudUser) await signInWithGoogle()
        const list = await listMyScenes()
        if (alive) setScenes(list)
      } catch (e) {
        if (alive) setError(msgOf(e))
      }
    })()
    return () => {
      alive = false
    }
  }, [])

  const load = async (id: string) => {
    const s = useStore.getState()
    s.setCloudBusy(true)
    try {
      await loadSceneFromCloud(id)
      onClose()
    } catch (e) {
      setError(msgOf(e))
    } finally {
      s.setCloudBusy(false)
    }
  }

  const remove = async (id: string) => {
    if (!window.confirm('このクラウドシーンを削除しますか?')) return
    try {
      await deleteCloudScene(id)
      setScenes((cur) => cur?.filter((x) => x.id !== id) ?? null)
    } catch (e) {
      setError(msgOf(e))
    }
  }

  const needle = q.trim().toLowerCase()
  const filtered = scenes?.filter((sc) => !needle || sc.name.toLowerCase().includes(needle)) ?? null

  return (
    <div className="help-overlay" onClick={onClose}>
      <div className="help-card cloud-modal" onClick={(e) => e.stopPropagation()}>
        <h3>クラウドのシーン</h3>
        {error && <div className="cloud-error">{error}</div>}
        {!scenes && !error && <div className="empty">読み込み中…</div>}
        {scenes && scenes.length === 0 && <div className="empty">まだ保存されたシーンはありません。</div>}
        {scenes && scenes.length > 0 && (
          <div className="cloud-toolbar">
            <input
              className="text"
              placeholder="シーン名で絞り込み"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            <span className="cloud-count">
              {needle ? `${filtered?.length} / ${scenes.length}` : `${scenes.length}`} 件
            </span>
          </div>
        )}
        <ul className="item-list">
          {filtered?.map((sc) => (
            <li key={sc.id} style={{ display: 'block' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span className="shot-name" style={{ flex: 1 }}>
                  {sc.name}
                </span>
                <span className="kind">{fmtDate(sc.updatedAt)}</span>
                <button className="mini" title="エージェント公開を承認(トークン発行)" onClick={() => approve(sc.id)}>
                  🤖承認
                </button>
                <button className="mini" onClick={() => load(sc.id)}>
                  開く
                </button>
                <button className="mini danger" onClick={() => remove(sc.id)}>
                  ✕
                </button>
              </div>
              {token?.sceneId === sc.id && (
                <div className="asset-editor">
                  <p className="welcome-lead" style={{ margin: '0 0 6px' }}>
                    公開承認トークン(10分有効・1回限り)。エージェントの <code>publish_scene</code> に渡してください。
                  </p>
                  <div className="row-body">
                    <input className="text" readOnly value={token.value} onFocus={(e) => e.currentTarget.select()} />
                    <button
                      className="mini"
                      onClick={() => {
                        navigator.clipboard?.writeText(token.value).then(
                          () => {
                            setCopied(true)
                            setTimeout(() => setCopied(false), 1500)
                          },
                          () => {},
                        )
                      }}
                    >
                      {copied ? 'コピーしました' : 'コピー'}
                    </button>
                  </div>
                </div>
              )}
            </li>
          ))}
          {filtered && filtered.length === 0 && scenes && scenes.length > 0 && (
            <li className="empty" style={{ cursor: 'default' }}>
              「{q}」に一致するシーンはありません
            </li>
          )}
        </ul>
        <button className="wide" onClick={onClose}>
          閉じる
        </button>
      </div>
    </div>
  )
}

/** AI エージェント連携 (MCP) 用に、自分のアカウントID(uid)を表示・コピーする */
function AgentLinkModal({ uid, onClose }: { uid: string; onClose: () => void }) {
  const [copied, setCopied] = useState(false)
  const copy = () => {
    navigator.clipboard?.writeText(uid).then(
      () => {
        setCopied(true)
        setTimeout(() => setCopied(false), 1500)
      },
      () => {},
    )
  }
  return (
    <div className="help-overlay" onClick={onClose}>
      <div className="help-card cloud-modal" onClick={(e) => e.stopPropagation()}>
        <h3>エージェント連携 (MCP)</h3>
        <p className="welcome-lead">
          Claude や Codex などの AI エージェントから、あなたのアセットでシーンを編集できます。
          連携には下のアカウントID (uid) を使います。
        </p>
        <div className="row">
          <span className="row-label">アカウントID</span>
          <div className="row-body">
            <input className="text" readOnly value={uid} onFocus={(e) => e.currentTarget.select()} />
            <button className="mini" onClick={copy}>
              {copied ? 'コピーしました' : 'コピー'}
            </button>
          </div>
        </div>
        <p className="welcome-lead">
          セットアップ手順は <code>mcp-server/README</code> を参照。サービスアカウント鍵などの秘密は
          このIDと違って共有しないでください。
        </p>
        <button className="wide" onClick={onClose}>
          閉じる
        </button>
      </div>
    </div>
  )
}

function DeleteAccountModal({ onClose }: { onClose: () => void }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  const doDelete = async () => {
    setError(null)
    setBusy(true)
    try {
      await deleteAccount()
      useStore.getState().setCloudSceneId(null)
      useStore.getState().setPublishedId(null)
      setDone(true)
    } catch (e) {
      setError(msgOf(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="help-overlay" onClick={onClose}>
      <div className="help-card cloud-modal" onClick={(e) => e.stopPropagation()}>
        <h3>アカウントを削除</h3>
        {done ? (
          <>
            <p className="welcome-lead">
              アカウントと、クラウドに保存・公開したシーンを削除しました。公開していた URL は閲覧できなくなります。
            </p>
            <button className="wide" onClick={onClose}>
              閉じる
            </button>
          </>
        ) : (
          <>
            <p className="welcome-lead">
              アカウントと、あなたがクラウドに保存・公開したすべてのシーンを削除します。
              公開していた <code>/s/...</code> の URL は閲覧できなくなります。
              <b>この操作は元に戻せません。</b>
            </p>
            <p className="welcome-lead">
              編集中のローカルシーンは消えません(必要なら先に Save Scene で JSON 保存してください)。
            </p>
            {error && <div className="cloud-error">{error}</div>}
            <div className="publish-actions">
              <button onClick={onClose}>キャンセル</button>
              <button className="primary danger" disabled={busy} onClick={doDelete}>
                {busy ? '削除中…' : '削除する'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
