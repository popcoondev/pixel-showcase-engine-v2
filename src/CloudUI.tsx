import { useEffect, useState } from 'react'
import { deleteAccount } from './cloud/account'
import { createSceneFromAssets } from './cloud/aiCompose'
import { listLibraryAssets, type LibraryAsset } from './cloud/assets'
import { signInWithGoogle, signOutCloud } from './cloud/auth'
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

/** アカウントのアセットからサーバ側で新シーンを生成し、読み込む (DR-2026-008) */
async function doAiCompose() {
  const s = useStore.getState()
  try {
    if (!s.cloudUser) await signInWithGoogle()
    s.setCloudBusy(true)
    const res = await createSceneFromAssets({ turntable: false })
    await loadSceneFromCloud(res.sceneId)
    s.flash(`AI が ${res.objectCount} 点でシーンを生成しました`)
  } catch (e) {
    s.flash(`AI生成に失敗: ${msgOf(e)}`)
  } finally {
    s.setCloudBusy(false)
  }
}

/** トップバーのアカウント表示 / サインイン・アウト / 退会 */
export function CloudAccount() {
  const cloudUser = useStore((s) => s.cloudUser)
  const cloudBusy = useStore((s) => s.cloudBusy)
  const [deleting, setDeleting] = useState(false)

  if (cloudUser) {
    return (
      <span className="cloud-account">
        <span className="cloud-name">{cloudUser.name ?? 'サインイン中'}</span>
        <button className="mini" disabled={cloudBusy} onClick={() => signOutCloud()}>
          サインアウト
        </button>
        <button className="mini danger" disabled={cloudBusy} onClick={() => setDeleting(true)}>
          退会
        </button>
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
      <button disabled={cloudBusy} onClick={doAiCompose} title="アカウントのアセットから自動でシーンを生成">
        ✨ AIで組む
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

  const place = async (a: LibraryAsset) => {
    const s = useStore.getState()
    try {
      s.registerAssetUrl(a.hash, a.url)
      if (a.kind === 'glb') {
        s.addGlb(a.hash, a.name)
      } else {
        const aspect = await imageAspect(a.url)
        s.addPlane(a.hash, aspect, a.name)
      }
      s.flash(`「${a.name}」を配置しました`)
      onClose()
    } catch (e) {
      setError(msgOf(e))
    }
  }

  return (
    <div className="help-overlay" onClick={onClose}>
      <div className="help-card cloud-modal" onClick={(e) => e.stopPropagation()}>
        <h3>アセットライブラリ</h3>
        <p className="welcome-lead">
          このアカウントで保存したシーンのオブジェクトです。クリックで今のシーンに配置できます。
        </p>
        {error && <div className="cloud-error">{error}</div>}
        {!assets && !error && <div className="empty">読み込み中…</div>}
        {assets && assets.length === 0 && (
          <div className="empty">まだアセットがありません。GLB/画像を置いてクラウド保存すると貯まります。</div>
        )}
        <ul className="item-list">
          {assets?.map((a) => (
            <li key={a.hash}>
              <span className="shot-name">{a.name}</span>
              <span className="kind">{a.kind === 'glb' ? '3D' : '画像'}</span>
              <button className="mini" onClick={() => place(a)}>
                配置
              </button>
            </li>
          ))}
        </ul>
        <button className="wide" onClick={onClose}>
          閉じる
        </button>
      </div>
    </div>
  )
}

function CloudScenesModal({ onClose }: { onClose: () => void }) {
  const [scenes, setScenes] = useState<CloudSceneMeta[] | null>(null)
  const [error, setError] = useState<string | null>(null)

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

  return (
    <div className="help-overlay" onClick={onClose}>
      <div className="help-card cloud-modal" onClick={(e) => e.stopPropagation()}>
        <h3>クラウドのシーン</h3>
        {error && <div className="cloud-error">{error}</div>}
        {!scenes && !error && <div className="empty">読み込み中…</div>}
        {scenes && scenes.length === 0 && <div className="empty">まだ保存されたシーンはありません。</div>}
        <ul className="item-list">
          {scenes?.map((sc) => (
            <li key={sc.id}>
              <span className="shot-name">{sc.name}</span>
              <button className="mini" onClick={() => load(sc.id)}>
                開く
              </button>
              <button className="mini danger" onClick={() => remove(sc.id)}>
                ✕
              </button>
            </li>
          ))}
        </ul>
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
