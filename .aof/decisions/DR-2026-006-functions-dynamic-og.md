# Decision Record: DR-2026-006 — Cloud Functions 解禁 + 動的OG

- Record Format Version: 1
- Created At: 2026-06-12
- Framework: AOF v2.1.0
- Governance: maintainer decision (DR-2026-005 でエスカレーションした gate の解除)
- Status: Adopted
- Human Maintainer: popcoondev (Cloud Functions 解禁を承認)

---

## 1. Decision

DR-2026-004 で Phase2.1 送りにし、DR-2026-005 で maintainer へエスカレーションした **「Cloud Functions を解禁するか」** を、maintainer が **GO** と判断。これにより:
- **TASK-018 動的OG**(/s/{id} を SNS に貼ると絵が出る)を解禁
- 退会時の **Storage 完全削除 / 孤立アセット GC**(Admin SDK の listing が要る)も将来 Functions で対応可能に

コスト理解(maintainer 合意): 金銭はほぼゼロ(無料枠内)。本質コストは「100%静的の気楽さ」を手放し、薄いバックエンド(デプロイ対象・コールドスタート・Admin SDK の特権境界・保守)を1つ持つこと。

## 2. 設計 (動的OG)

- **Cloud Functions gen2**(region asia-northeast1)、firebase-admin + firebase-functions v2。
- Function `ogShowcase` (HTTP): リクエスト `/s/{id}` から id を取り、
  1. Hosting の `index.html` を取得(現行バンドル参照を保持)
  2. `showcases/{id}` を Admin SDK で読み(title / ownerName / thumbUrl)
  3. `<head>` に OG/Twitter meta を注入して返す
  → **人間**はそのままアプリが起動、**bot**は meta を読む(同一応答)。
- **og:image** は公開サムネの download URL。publish 時に thumbUrl を showcases doc に保存(TASK-013 publish.ts を更新)。未保存の旧公開は og:image 省略(title/desc は出る)。
- Hosting rewrite: `/s/**` → function、`**` → /index.html。`/index.html` は static のまま(fetch ループなし)。
- **App Check 整合**: Function の public endpoint は App Check 対象外(bot はトークンを持てない)。Function は Admin SDK で Firestore を読む=Rules/App Check を素通りする特権。読むのは公開コレクション showcases のみに限定(未公開 users/* は読まない)。
- **デプロイ順序**: Function を先にデプロイ → その後 Hosting に rewrite を反映(逆だと /s/ が壊れる)。Functions は手動 `firebase deploy --only functions`(CI は Hosting のみのまま)。

## 3. リスクと対処 (Operations)
- 特権境界: Function は公開 showcases のみ読む。未公開データは読まない。サービスアカウント JSON はリポジトリに入れない(Google 管理)。
- コスト: gen2 無料枠(月200万呼び出し)。OGクロールは共有回数依存で僅少。Budget アラート(設定済)で監視。
- コールドスタート: bot は許容。人間も同一応答だが同一リージョン CDN+1 read で軽微。
- 保守: Node ランタイム deprecation を監視(Hosting workflow と同様)。

## 4. スコープ
- 今回: 動的OG(`ogShowcase` function + thumbUrl 保存 + rewrite)。
- 後続(同じ Functions 基盤で): 退会時の Storage 完全削除 / 孤立アセット GC(管理スクリプト or scheduled function)。

## 5. 次に誰が何を
| 担当 | アクション |
|---|---|
| Builder / viewer-team | functions/ogShowcase 実装、publish.ts に thumbUrl、firebase.json rewrite |
| Builder | function を先行デプロイ → 直 URL を curl 検証 → hosting に rewrite 反映 |
| Maintainer | 実運用後、SNS に実際に貼ってカード表示を確認 |
| Operations Council | function が公開コレクションのみ読むこと、コスト推移を確認 |
