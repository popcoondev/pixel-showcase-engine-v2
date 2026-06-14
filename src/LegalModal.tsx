import { useState } from 'react'

const CONTACT = 'https://x.com/moso_x2'

/** フッター等に置く小さなリンク + 規約/プライバシーのモーダル。 */
export function LegalLink({ className }: { className?: string }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <a
        className={className ?? 'contact-link'}
        href="#"
        onClick={(e) => {
          e.preventDefault()
          setOpen(true)
        }}
      >
        規約・プライバシー
      </a>
      {open && <LegalModal onClose={() => setOpen(false)} />}
    </>
  )
}

function LegalModal({ onClose }: { onClose: () => void }) {
  return (
    <div className="help-overlay" onClick={onClose}>
      <div className="help-card legal-card" onClick={(e) => e.stopPropagation()}>
        <h3>利用規約・プライバシーポリシー</h3>
        <div className="legal-body">
          <h4>利用規約</h4>
          <ul>
            <li>本サービス(Pixel Showcase)は、3D 展示シーンを作成・保存・公開するための個人運営ツールです。</li>
            <li>
              アップロード・公開するアセット(GLB・画像など)について、利用者は<b>権利を有しているか正当な使用許諾を得ている</b>必要があります。第三者の権利を侵害するコンテンツの公開を禁止します。
            </li>
            <li>違法・公序良俗に反するコンテンツの公開を禁止します。</li>
            <li>
              本サービスは<b>現状有姿</b>で提供され、可用性・データの保全について保証しません。データの消失・サービスの変更/停止について、運営者は責任を負いません(重要なシーンは Save Scene で手元に保存してください)。
            </li>
            <li>権利侵害等の申し立てを受けた場合、運営者は該当コンテンツを予告なく削除することがあります。</li>
            <li>準拠法は日本法とします。</li>
          </ul>

          <h4>プライバシーポリシー</h4>
          <ul>
            <li>
              <b>取得する情報</b>: Google サインイン時のアカウント識別子(uid)と表示名、利用者が作成・公開したシーンデータおよびアセット、アクセス時の技術情報(IP アドレス等、インフラ事業者を通じて)。
            </li>
            <li>
              <b>利用目的</b>: シーンの保存・公開・表示というサービス提供のため。<b>メールアドレスは保存・表示しません</b>。
            </li>
            <li>
              <b>インフラ</b>: Google Firebase(Hosting / Authentication / Firestore / Storage / Cloud Functions / App Check)を利用します。これに伴い Google のプライバシーポリシーが適用されます。
            </li>
            <li>
              <b>公開範囲</b>: 「公開」したシーンは URL を知る誰でも閲覧でき、設定した<b>作者表示名</b>が表示されます。uid やメールは公開されません。
            </li>
            <li>
              <b>削除</b>: 画面右上の「退会」から、アカウントと保存・公開したシーンを削除できます(公開 URL は閲覧不可になります)。
            </li>
            <li>
              <b>お問い合わせ</b>: <a className="contact-link" href={CONTACT} target="_blank" rel="noopener noreferrer">X (@moso_x2)</a> までご連絡ください。
            </li>
          </ul>
          <p className="legal-note">最終更新: 2026-06-14</p>
        </div>
        <button className="wide" onClick={onClose}>
          閉じる
        </button>
      </div>
    </div>
  )
}
