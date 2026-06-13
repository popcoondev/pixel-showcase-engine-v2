import { useEffect, useState } from 'react'
import { deleteAccount } from './cloud/account'
import { signInWithGoogle, signOutCloud } from './cloud/auth'
import {
  deleteCloudScene,
  listMyScenes,
  loadSceneFromCloud,
  saveSceneToCloud,
  type CloudSceneMeta,
} from './cloud/scenes'
import { useStore } from './store'

function msgOf(e: unknown): string {
  const code = (e as { code?: string })?.code ?? ''
  if (code.includes('popup-closed') || code.includes('cancelled')) return 'サインインを中止しました'
  if (code.includes('requires-recent-login'))
    return 'セキュリティのため、一度サインアウトして再サインインしてから削除してください'
  if (code.includes('permission')) return '権限がありません (ルール未デプロイ?)'
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

/** フッターのクラウド操作 (保存 / 開く) + シーン一覧モーダル */
export function CloudBar() {
  const cloudBusy = useStore((s) => s.cloudBusy)
  const [open, setOpen] = useState(false)

  return (
    <div className="footer-group">
      <button disabled={cloudBusy} onClick={doCloudSave}>
        ☁ 保存
      </button>
      <button disabled={cloudBusy} onClick={() => setOpen(true)}>
        ☁ 開く
      </button>
      {open && <CloudScenesModal onClose={() => setOpen(false)} />}
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
