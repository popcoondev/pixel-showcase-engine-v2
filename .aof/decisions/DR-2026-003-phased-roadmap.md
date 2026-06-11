# Decision Record: DR-2026-003 — フェーズ別ロードマップ (Phase 1 / Phase 2)

- Record Format Version: 1
- Created At: 2026-06-11
- Topology: managed-project (AOF v2.0.0)
- Governance: human-maintainer direction(roadmap は human の決定。Phase2 アーキは着手時に Council）
- Status: Adopted
- Human Maintainer: popcoondev

---

## 1. Framing (Need / Intent / Context)

**Need**: 「展示を他者に見せられる」ところまでの到達経路を、実装可能なフェーズに分ける。

**Intent**: まず軽く公開し(Phase1)、その後にサーバー保存と共有を本格化する(Phase2)。共有手段をフェーズで段階化する。

**Context**: human maintainer が2フェーズ構成を提示。ホスティング/バックエンドは **Firebase** を想定(Hosting / Firestore / Storage / Auth が両フェーズをまたいで使える)。

---

## 2. Roadmap

### North Star(不変)
「置く・照らす・撮る・固定画角で見せる」を成立させ、作った展示を本人以外にも見せられる。

### Phase 1 — 静的エディタを公開ホストに載せる(共有 = 書き出しファイル)
- Vite ビルドを **Firebase Hosting** にデプロイ。公開URLでエディタがブラウザで動く。
- 共有は **Preview からの PNG / mp4 書き出し**(v0.1.0 実装済み)。サーバー保存はしない。
- 状態はブラウザの IndexedDB(ローカル)のまま。DRACO デコーダは public/ 同梱で静的ホストでも動作。
- 最小テスト + CI を同じ流れで導入(デプロイの green ゲート)。

### Phase 2 — Firebase バックエンド(共有 = サーバー保存 + プレビューURL)
- **Firestore**: シーンファイル(Scene JSON v2 メタ/参照)を保存。
- **Firebase Storage**: GLB / 画像アセットの実体を格納(DB blob 直格納はしない)。Scene v2 のハッシュ参照(assets テーブル)と相性が良い。
- **Firebase Auth**: アカウント単位で自分のシーン/アセットを管理。
- **プレビュー専用ページ**: 既存の固定画角 Viewer(`?showcase=slug`、編集不可)の**データ源を IndexedDB → バックエンドに差し替える**もの。ゼロから作らない。

---

## 3. Governance Note(重要)

Phase 2 は、DR-2026-001 で **Guardian が veto したバックエンド保存**を再開する。human maintainer の権限で veto を上書きするが、Guardian の条件は **Phase2 の設計要件**として引き継ぐ:

- アセットの**容量上限**
- アセット**権利 / 利用規約**(他者 GLB の再配布前提への対処)
- **アカウント / 認証**(Firebase Auth で充足)
- **PII** の扱い

→ Phase2 着手時に Council of Three を回し、アーキテクチャ(データモデル・セキュリティルール・容量/権利・認証フロー)を DR 化する。

---

## 4. タスク再マッピング

| タスク | 旧 | 新フェーズ |
|--------|----|-----------|
| TASK-001 DRACO | slice-1 | **Phase1 基盤(done)** |
| **TASK-011 Firebase Hosting デプロイ + CI** (新) | — | **Phase1 slice** |
| TASK-002 最小テスト + CI | slice-1 | **Phase1 slice**(デプロイCIに統合) |
| TASK-004 THUMB | fast-follow | Phase1 fast-follow(OG/共有素材) |
| TASK-005 ONBOARD | fast-follow | Phase1 fast-follow(公開時の初回体験) |
| TASK-003 SHARE自己完結HTML | slice-1 | **Phase2 へ降格・再定義**(backend 保存に吸収) |
| **TASK-012 Firebase backend** (新) | — | **Phase2**(Firestore + Storage + Auth) |
| **TASK-013 プレビュー専用ページ** (新) | — | **Phase2**(Viewer のデータ源差し替え) |
| TASK-006 PRESETS / 007 MULTISHOT / 008 FXMORE | backlog | cross-phase backlog |
| TASK-009 MOBILE / 010 PERF | backlog-later | backlog-later |

---

## 5. 現在地

- **Current Operating Goal** → Phase1(`.aof/goals/operating-goal.json`)
- **Next Value Slice** → Firebase Hosting デプロイ + PNG/mp4 共有の確認 + CI(`.aof/goals/next-value-slice.json`)
- TASK-001 DRACO は完了済み。次の着手は TASK-011(デプロイ)/ TASK-002(CI)。

## 6. 次に誰が何を

| 担当 | アクション |
|------|-----------|
| **Human (popcoondev)** | Firebase プロジェクト作成 + project id 共有(Hosting デプロイの前提)。 |
| **Builder (= Claude Code)** | TASK-011: `firebase.json` + Vite base 設定 + GitHub Actions デプロイ。TASK-002 の CI を同梱。 |
| **Guardian** | デプロイ CI に build/test green ゲート。Phase2 の veto 条件を要件として保持。 |
| **Council** | Phase2 着手時にバックエンドアーキを判断し DR-2026-00x を起こす。 |

---

## Project Note
managed-project。Phase2 のバックエンドは product 外部サービス(Firebase)。`.aof/` は human 指示の session 内でのみ更新。
