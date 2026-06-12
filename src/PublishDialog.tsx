import { useState } from 'react'
import { signInWithGoogle } from './cloud/auth'
import { publishToCloud } from './cloud/publish'
import { useStore } from './store'

function msgOf(e: unknown): string {
  const code = (e as { code?: string })?.code ?? ''
  const m = (e as Error)?.message ?? ''
  if (m === 'no-shots') return '先に Shot を保存してください (R)。固定画角で見せるため Shot が必要です'
  if (m === 'not-signed-in' || code.includes('popup-closed') || code.includes('cancelled'))
    return 'サインインが必要です'
  if (code.includes('permission')) return '権限がありません (App Check / ルールを確認)'
  return m || 'エラーが発生しました'
}

const CONTACT_URL = 'https://github.com/popcoondev/pixel-showcase-engine-v2/issues/new'

export function PublishButton() {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button onClick={() => setOpen(true)}>Publish</button>
      {open && <PublishDialog onClose={() => setOpen(false)} />}
    </>
  )
}

function PublishDialog({ onClose }: { onClose: () => void }) {
  const cloudUser = useStore((s) => s.cloudUser)
  const shots = useStore((s) => s.shots)
  const publishedId = useStore((s) => s.publishedId)
  const [title, setTitle] = useState(useStore.getState().sceneName)
  const [author, setAuthor] = useState(cloudUser?.name ?? '')
  // 既に公開済みなら権利確認は同意済みとみなし、更新をデフォルトにする
  const [agreed, setAgreed] = useState(!!publishedId)
  const [asNew, setAsNew] = useState(false)
  const [busy, setBusy] = useState(false)
  const [url, setUrl] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const isUpdate = !!publishedId && !asNew

  const doPublish = async () => {
    setError(null)
    setBusy(true)
    try {
      if (!useStore.getState().cloudUser) await signInWithGoogle()
      const id = await publishToCloud(
        title.trim() || 'untitled',
        author.trim(),
        isUpdate ? publishedId : null,
      )
      useStore.getState().setPublishedId(id)
      setUrl(`${window.location.origin}/s/${id}`)
    } catch (e) {
      setError(msgOf(e))
    } finally {
      setBusy(false)
    }
  }

  const copy = async () => {
    if (!url) return
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      setError('コピーできませんでした。URL を選択してコピーしてください')
    }
  }

  return (
    <div className="help-overlay" onClick={onClose}>
      <div className="help-card publish-modal" onClick={(e) => e.stopPropagation()}>
        <h3>{isUpdate ? '公開を更新する' : '公開する'}</h3>

        {url ? (
          <>
            <p className="welcome-lead">
              {isUpdate ? '公開を更新しました。URL は同じです:' : '公開しました。この URL を共有できます:'}
            </p>
            <div className="publish-url-row">
              <input className="text" readOnly value={url} onFocus={(e) => e.target.select()} />
              <button onClick={copy}>{copied ? 'コピー済' : 'コピー'}</button>
            </div>
            <p className="welcome-lead">
              <a className="contact-link" href={url} target="_blank" rel="noopener noreferrer">
                開いて確認する ↗
              </a>
            </p>
            <button className="wide" onClick={onClose}>
              閉じる
            </button>
          </>
        ) : (
          <>
            {publishedId && (
              <div className="publish-note">
                この作品は公開済みです(
                <a
                  className="contact-link"
                  href={`${window.location.origin}/s/${publishedId}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  /s/{publishedId}
                </a>
                )。
                <label className="publish-asnew">
                  <input type="checkbox" checked={asNew} onChange={(e) => setAsNew(e.target.checked)} />
                  別URLで新規公開する
                </label>
              </div>
            )}
            {shots.length === 0 && (
              <div className="cloud-error">
                先に Shot を保存してください (R)。公開ページは固定画角の Shot を見せます。
              </div>
            )}
            <div className="row">
              <span className="row-label">タイトル</span>
              <input className="text" value={title} onChange={(e) => setTitle(e.target.value)} />
            </div>
            <div className="row">
              <span className="row-label">作者名</span>
              <input
                className="text"
                value={author}
                placeholder="(任意・公開ページに表示)"
                onChange={(e) => setAuthor(e.target.value)}
              />
            </div>
            <label className="publish-terms">
              <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
              <span>
                このシーンに含まれるすべてのアセット(GLB・画像)の権利または使用権を有しており、
                公開して問題ないことを確認しました。
                権利侵害等は <a className="contact-link" href={CONTACT_URL} target="_blank" rel="noopener noreferrer">こちら</a> から通報できます。
              </span>
            </label>
            {error && <div className="cloud-error">{error}</div>}
            <div className="publish-actions">
              <button onClick={onClose}>キャンセル</button>
              <button
                className="primary"
                disabled={busy || !agreed || shots.length === 0}
                onClick={doPublish}
              >
                {busy
                  ? isUpdate
                    ? '更新中…'
                    : '公開中…'
                  : !cloudUser
                    ? 'サインインして公開'
                    : isUpdate
                      ? '公開を更新'
                      : '公開'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
