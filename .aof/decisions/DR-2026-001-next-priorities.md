# Decision Record: DR-2026-001 — 次の改善優先順位

- Record Format Version: 1
- Created At: 2026-06-11
- Topology: managed-project (AOF v2.0.0)
- Governance: council-of-three / majority-with-guardian-veto
- Status: Adopted
- Human Maintainer: popcoondev

---

## 1. Request Framing (Need / Intent / Context)

**Need**
Pixel Showcase Engine v0.1.0 の「次に何を改善するか」を、思いつきでなく判断可能な形で決め、組織として走り出せる状態にする。

**Intent**
- コア機能が一通り揃った今、**価値の優先順位**を Council of Three で確定する。
- 非要件(ゲーム化しない / Viewer自由移動なし / Blender化しない / 操作の自然さ優先)を侵さない範囲で決める。
- 決定を `.aof/` に残し、次の実行に還流する。

**Context**
- v0.1.0 実装済み: Edit/Camera/Preview + 固定画角Viewer、GLB/画像/Cube/Plane配置、look-dev、HD-2D lookプリセット、実カメラUI+DOF、カメラワーク、FX 8種、Shot/PNG/MP4録画、Scene JSON v2(アセット重複排除)、IndexedDB Publish、Undo/Redo。
- 既知ギャップ: Publishがlocalhost専用で共有不可 / 圧縮GLB非対応 / サムネなし / 複数Shot UI弱い / テスト・CIなし / モバイル未検証 / 初回起動が空。
- North Star: 「置く・照らす・撮る・固定画角で見せる」を成立させ、**作った展示を本人以外にも見せられる**こと。

---

## 2. 組織と進め方

Parent AI(Claude Code)が framing を固定し、Council of Three を**並列**で起動。共通の改善候補スレート(10件)を各レンズで独立採点させた。各ロールは自レンズの判定に加え、他2ロールの反論を予測して応答する cross-awareness を含めた(= worker output の相互 judge)。Parent が governance を適用して集約。

- **Visionary** (value/intent): 価値・ビジョン整合
- **Builder** (feasibility/execution): 実装コスト・依存・順序(実コードを精査)
- **Guardian** (risk/quality/safety, veto権): リスク・可逆性・技術的負債(実コードを精査)

---

## 3. 各ロールの判断

### 採点マトリクス(1–5)

| 候補 | Visionary | Builder | Guardian | 合計 |
|------|:--:|:--:|:--:|:--:|
| ONBOARD 初回サンプル+ガイド | 4 | 5 | 5 | **14** |
| THUMB サムネ/OG画像 | 4 | 5 | 4 | **13** |
| DRACO 圧縮GLB対応 | 4 | 5 | 4 | **13** |
| SHARE 静的HTML書き出し | 5 | 4 | 3 | **12** |
| PRESETS プリセット | 3 | 4 | 4 | **11** |
| MULTISHOT 複数Shot | 3 | 4 | 3 | **10** |
| TESTCI テスト+CI | 1 | 3 | 5 | **9** |
| FXMORE FX種追加 | 2 | 4 | 2 | **8** |
| PERF 多数GLB性能 | 2 | 2 | 3 | **7** |
| MOBILE モバイル | 2 | 2 | 2 | **6** |
| SHARE 公開URLバックエンド | — | — | **1 (VETO)** | — |

### Visionary 要旨
- 「見せる」が今ローカルの袋小路で止まっている。**SHARE が最大の穴(#1)**。
- 価値observations: FXMORE と MULTISHOT のスライドショー化は非要件(ゲーム化/自由移動/DCC化)に最も近い。注意。
- 次の一手: **SHARE を先に出す**。

### Builder 要旨
- 既存構造(assets = content-hash付き dataURL、scene = 純JSON、Viewer = ?showcase=slug)の延長は安い。
- impact/cost で **DRACO(S, ほぼ数行)→ THUMB(S)→ ONBOARD(S)→ SHARE静的(M)→ MULTISHOT(M)**。
- 依存: DRACO→全GLB系、THUMB→MULTISHOT/SHARE(OG)、ONBOARD→SHARE(デモ)。
- 次の一手: **DRACO を今日入れる**(以後の全デモ/共有の前提)。

### Guardian 要旨
- テスト/CI皆無での積み増しは**見えない回帰を複利で蓄積**。
- **VETO: SHARE バックエンド型**(他者GLBの再配布・権利・容量・PII・運用リスク、スコープ外)。
- **GATE**: SHARE静的(サイズ上限+事前表示+DRACO先行)、MULTISHOT(自動スライドショーは差し戻し)、MOBILE(Viewer限定)、FXMORE(optionalフィールド+テスト後)。
- 実コードから実バグを指摘: `publishToLocalViewer` の「URLをコピーしました」はlocalhost専用なのに他者共有を期待させる体験バグ / `hashDataUrl` のMIME prefix差で重複排除漏れ / `migrateSceneFile`+`legacyEnvEffects` の二段マイグレーション無音破壊リスク。
- 次の一手: **純粋関数の最小Vitestを今週入れる**。これ以外はテストなしで進めることを許可しない(gate)。

---

## 4. 一致点 / 衝突点

**一致点**
- **DRACO / ONBOARD / THUMB** は3者とも高評価・低コスト・低リスク → 即実行で合意。
- **SHARE バックエンド型は不採用**(Guardian veto、他2者も静的型を支持)。
- **SHARE 静的型がビジョンの本命**。アプローチは一致、争点は順序のみ。
- PERF / MOBILE は3者とも低、今ではない。MOBILE をやるなら Viewer 限定。

**衝突点**
1. **TESTCI の優先度**: Visionary 1(価値直結なし)↔ Guardian 5+veto級(土台なしで積むな)。Builder は「純粋関数なら今日から安い」と中立寄り。
   → **集約**: 大掛かりなテスト計画ではなく、**純粋関数の最小スモーク+CI** に絞り、価値スライスと**並走**させる。Guardian の gate を安価に満たしつつ Visionary の「価値を止めるな」も成立。
2. **SHARE の順序**: Visionary「最初」↔ Builder/Guardian「土台(DRACO+最小テスト)先行」。
   → **集約**: 土台はいずれも安価で SHARE を実用化する。**DRACO → 最小テスト → SHARE** の順で、スライス内に全部入れる。SHARE はスライスの主成果。

---

## 5. 優先順位付き改善案トップ5(governance 適用後)

合計点ランキングに、Guardian gate と Builder の依存グラフを重ねた最終順:

1. **DRACO 圧縮GLBローダー対応** (S) — 3者最高合意の土台。実物GLBが読め、SHAREのアセット縮小前提。最小リスク最大レバレッジ。
2. **最小スモークテスト + CI** (S) — Guardian gate を安価に充足。純粋関数(migrate/hash/focal/serialize往復)+ Actions。並走。
3. **静的自己完結HTMLエクスポート + 誤Publishメッセージ是正** (M) — ビジョン最大の穴を塞ぐ主成果。backend は veto、static のみ、サイズ上限+事前表示。
4. **THUMB サムネ/OG画像自動生成** (S, fast-follow) — SHAREのOG/一覧を底上げ。サムネはIndexedDBにid参照で保存しUndoを汚さない。
5. **ONBOARD 初回サンプル+最小ガイド** (S, fast-follow) — ゼロリスクで初回体験の最大欠落を解消。SHAREのデモ素材も兼ねる。

**次点(backlog)**: PRESETS(#6)→ MULTISHOT(#7, 固定画角の範囲)→ FXMORE(#8, gate)→ MOBILE(#9, Viewer限定)→ PERF(#10, 後日)。

---

## 6. Current Operating Goal

作った展示を『本人以外も見られる形で外に出せる』状態にする。最大の穴である共有経路(SHARE)を、それを実用にする安価な土台(DRACO・最小テスト)とともに閉じる。

→ `.aof/goals/operating-goal.json`

## 7. Next Value Slice — "Shareable showcase" (v0.2.0 candidate)

圧縮GLBを含むシーンを自己完結HTMLとして書き出し、他者がブラウザで開いて固定画角Shotを閲覧できる。最小テスト/CIで守る。
- In-slice: TASK-001 DRACO / TASK-002 最小テスト+CI / TASK-003 SHARE静的+誤メッセージ是正
- Fast-follow: TASK-004 THUMB / TASK-005 ONBOARD
- Exit: 書き出した単一HTMLを別環境で開きShotが再生、CIが green。

→ `.aof/goals/next-value-slice.json`

## 8. Open Tasks Backlog

`.aof/tasks/open/TASK-001..010.json`。slice-1(001–003)→ fast-follow(004–005)→ backlog(006–008)→ backlog-later(009–010)。

## 9. 次に誰が何をやるか

| 順 | 担当 | アクション |
|----|------|-----------|
| 0 | **Human (popcoondev)** | スライス範囲を承認。SHARE のホスティング先(GitHub Pages か HTML配布のみか)を判断。DRACO受け入れ確認用の圧縮GLBを1つ提供(あれば)。 |
| 1 | **Builder** (= Claude Code 実行) | TASK-001 DRACO 着手(GlbContent に DRACOLoader、WASM を public/draco/)。 |
| 2 | **Guardian** | TASK-002 の最小テスト項目と受け入れ gate を確定。指摘した3バグの再現テストを含める。 |
| 3 | **Builder** | TASK-003 SHARE 静的書き出し(serialize() inline、サイズ上限+事前表示)。誤Publishメッセージ是正。 |
| 4 | **Visionary** | TASK-003 のエクスポートUX(書き出しページの見え方・サイズ警告文言)を spec 化し、SNS/ブログ用途に合致するか確認。 |
| - | fast-follow | TASK-004 THUMB → TASK-005 ONBOARD。 |

完了時は `aof outcome-report` 相当として Decision/Action/Artifact/Outcome を記録し、Operating Goal に還流する。

---

## Project Note
managed-project topology。product `main` は human-governed。cadence 自動化が `.aof/` を main に直接書き込むことは禁止。本 DR と `.aof/` 配置は human maintainer の明示指示による。
