# Decision Record: DR-2026-004 — Phase 2 Firebase バックエンドアーキテクチャ

- Record Format Version: 1
- Created At: 2026-06-11
- Topology: managed-project (AOF v2.0.0)
- Governance: council-of-three / majority-with-guardian-veto
- Status: Adopted (human 承認待ちの console 作業あり)
- Human Maintainer: popcoondev
- Supersedes-context: DR-2026-001 の backend veto を DR-2026-003 で human が上書き。本 DR はその条件(容量/権利/PII/認証)を設計に落とす。

---

## 1. Framing (Need / Intent / Context)

**Need**: シーンとアセットをサーバーに保存し、公開URLで他者がプレビューを見られる状態にする(Phase 2)。

**Intent**: 「作品がURLとして存在する」体験を、ソロ運用・従量課金でも安全に成立させる。

**Context**: v0.2.0 (Phase 1) 完了。Scene JSON v2 はアセットを content-hash 参照で分離済み、固定画角 Viewer は実装済み。Firebase project `pixelshowcase-7bc44`(Hosting 稼働中)。

---

## 2. 各ロールの判断(要旨)

### Visionary
- 体験の核は **(b) 公開URL共有**。「保存は便利、共有URLは作品の存在」。
- 認証: 匿名→昇格(摩擦を後置)を推す。
- 公開の単位は **Shot を顔に**(タイトル+作者名+固定画角再生のみ)。URL は `/s/{短ID}` + OG画像に Shot サムネ。
- 過剰機能の veto: コメント/いいね/ギャラリー/フォロー等の SNS 化は全部切る。

### Builder(コード精査済み)
- **assets(dataURL)を Firestore に入れたら 1MB 上限で即死** → Firestore はシーン純JSON + `assetRefs{hash→Storageパス}`、実体は Storage `assets/{hash}`(content-hash でユーザー横断の重複排除を継承)。
- 変換層は `serialize()` に手を入れず **`src/cloud/` に被せる**(ローカル保存/JSONエクスポート/Undo を壊さない)。
- プレビューページ = 既存 `detectViewerSlug` に `/s/{id}` 分岐を追加し、データ源を Firestore/Storage に。rewrites は既存 `** → /index.html` で追加設定不要。
- firebase SDK ~177KB gzip → **dynamic import で遅延ロード**(別エントリ分割は不要)。
- **新規プロジェクトの Storage は Blaze(従量)必須**。無料枠内で個人利用は実質無料だがカード登録要。
- スライス: A=Auth+クラウド保存(M) → B=公開+プレビューページ(S) → C=OG/その他(後送り)。

### Guardian(veto 権)
- 三重制約(従量課金・ソロ・モデレーター不在)では**安全をアーキテクチャで強制**するしかない。
- **VETO**: ①uid の URL/HTML 露出 ②匿名認証ユーザーへの書き込み/公開権限 ③App Check なしの本番公開 ④サイズ/型制限なしの Storage 開放 ⑤Budget アラート未設定での Blaze 移行。
- **GATE**: Storage 全アセット public read は「全アセット公開前提」を設計記録に明示すること(本 DR で明示・許可)/公開機能リリースは利用規約+権利確認UIが条件/退会の後回しは UI 案内が条件/アセットGCは「放置(C)で開始、コスト顕在化で Orphan GC(B)へ」。
- PII: email は保存しない・表示しない。公開ページに出すのは任意の表示名のみ。
- ローンチ条件: Budget アラート/サイズ+型 Rules/App Check/規約+権利確認UI/uid 非露出。

---

## 3. 一致点 / 衝突点と裁定

**一致点**
- 公開URL `/s/{id}`(Firestore 自動ID、uid 非露出)+ OG に Shot サムネ。
- Firestore=純JSON+参照、Storage=content-hash 実体、既存 Viewer 再利用、SNS化はしない。
- アセットは「公開前提」で割り切る(未公開シーンの**メタデータ**は非公開、アセット実体は hash を知れば読める)— Guardian gate に従い本 DR に明示して採用。

**衝突① 匿名認証**: Visionary「匿名→昇格で摩擦ゼロ」↔ Guardian「匿名への書き込み権限は VETO」。
→ **裁定: Guardian veto 採択**。書き込み/公開は **Google サインイン必須**(1クリック)。Visionary の意図(摩擦最小)は「サインインを求めるのは保存/公開ボタンを押した瞬間だけ・閲覧と編集はサインイン不要」で充足する。

**衝突② Cloud Functions による累積容量制御**: Guardian「4点セットに Functions 必須」↔ Builder のスライス規模(Functions はコスト増)。
→ **裁定: Phase 2.0 では Functions を導入しない**。代替として (a) ファイル 25MB 上限 + content-type 制限(Rules)、(b) ユーザーあたりシーン数上限(Rules の get() で強制)、(c) App Check、(d) Budget 二段アラート、で暴走面を抑える。累積バイト数の厳密制御と Orphan GC は **Phase 2.1 に gate 送り**(コスト顕在化または利用増で発動)。

**衝突③ Budget 自動停止**: Guardian「Blaze 移行と同日に自動停止まで」
→ **裁定: 二段アラート(例: ¥1,500 / ¥8,000)はローンチ必須**(human のコンソール作業)。**課金APIの自動無効化は Phase 2.1 推奨**に格下げ — 初期は露出が小さくアラートで検知可能、誤発火でサービス全停止するリスクとの均衡。Guardian の懸念は DR に記録し、human が同日設定を選ぶならそれを推奨する。

**衝突④ ファイルサイズ上限**: Guardian 50MB 案 → 主アセットは 1MB 級 GLB のため **25MB に強化**(より安全側)。

---

## 4. 採用アーキテクチャ

### Firestore
```
users/{uid}/showcases/{id}   ← 作業コピー (read/write = owner)
  name, updatedAt, scene{assetsを除く純JSON}, assetRefs{hash→path}, thumbRef

showcases/{id}               ← 公開スナップショット (read = 全員, write = owner)
  ownerId, ownerName(任意表示名), publishedAt, termsAgreedAt,
  scene{...}, assetRefs{...}, thumbRef
```
- `ownerUid` は作成後不変(Rules で強制)。未公開シーンは owner 以外 read 不可。
- シーン数上限: users/{uid}/showcases は 20 件まで(Rules)。

### Storage
```
assets/{hash}                ← GLB/画像実体。read=全員 / create=サインイン済+25MB以下+型制限 / update=禁止(改竄防止) / delete=Phase2.1
thumbs/{showcaseId}.jpg      ← 公開サムネ (OG用)
```
- content-type: `model/gltf-binary | image/png | image/jpeg | image/webp`
- クライアント申告 hash の偽装は可能だが、create-only により**既存アセットの改竄は不可**。偽 hash は偽装者自身のシーンしか壊さない(許容)。

### ルーティング / アプリ
- `/s/{showcaseId}` = 公開プレビュー(既存 viewerLocked Viewer のデータ源を Firestore/Storage に分岐)。閲覧はサインイン不要。
- firebase SDK は dynamic import(クラウド機能を使う瞬間のみロード)。
- `serialize()`/ローカル保存/Undo は無変更。クラウド変換層は `src/cloud/`。
- 公開時 UI: 権利確認チェック(「すべてのアセットの権利/使用権を有しています」)必須 + `termsAgreedAt` 記録。
- 表示: タイトル + 任意の作者表示名のみ。email/uid は保存・表示しない(uid は所有者判定のみ)。

### 実装スライス
| スライス | 内容 | 規模 | タスク |
|---|---|---|---|
| 2A | Firebase 基盤(SDK/dynamic import/Google Auth)+ クラウド保存・自分のシーン一覧/読込 | M | TASK-012 |
| 2B | 安全土台: Security Rules(サイズ/型/所有者/上限)+ App Check + 利用規約/権利確認UI + 通報窓口 | M | TASK-014 |
| 2C | 公開 + `/s/{id}` プレビューページ + OG サムネ | S-M | TASK-013 |
- 順序: 2A → 2B → 2C。**2B 完了が公開機能(2C)リリースの gate**(Guardian 条件)。
- Phase 2.1(後送り): 累積容量の厳密制御 / Orphan GC / 退会フロー(それまで UI に案内文) / Budget 自動停止。

---

## 5. ローンチ条件(Guardian、本 DR で確定)
1. Budget 二段アラート設定(Blaze 移行と同時)
2. Storage Rules: 25MB 上限 + content-type 制限 + create-only
3. App Check 有効(reCAPTCHA)
4. 利用規約ページ + 公開時の権利確認チェック UI
5. uid が URL/HTML/OG に露出しないことの確認

## 6. Human のコンソール作業(実装着手の前提)
1. **Blaze プランへアップグレード**(カード登録)+ **Budget 二段アラート**(例 ¥1,500/¥8,000)を同時設定
2. Authentication → **Google プロバイダ有効化**
3. **Firestore データベース作成**(asia-northeast1、本番モード)
4. **Storage 開始**(同ロケーション)
5. **App Check**(reCAPTCHA v3)を有効化し site key を共有
6. プロジェクト設定 → ウェブアプリ追加 → **firebaseConfig を共有**(これは公開情報で secret ではない)

## 7. 次に誰が何を
| 担当 | アクション |
|---|---|
| Human | 上記 1–6。完了したら firebaseConfig を貼る |
| Builder | TASK-012(2A)実装 → TASK-014(2B)→ TASK-013(2C) |
| Guardian | 2B の Rules レビューと、ローンチ条件チェックリストの最終確認 |
| Visionary | 公開ページの見え方(タイトル/作者名/OG)と公開フロー文言の確認 |
