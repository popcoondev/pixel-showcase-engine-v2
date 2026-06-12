# Decision Record: DR-2026-005 — 次の方向性 (v0.4.0 以降)

- Record Format Version: 1
- Created At: 2026-06-12
- Framework: AOF v2.1.0 (AI Organization Operating System)
- Governance: councils / 2_of_3 (escalation to maintainer)
- Organization: `.aof/organization.json` (Pixel Showcase Studio)
- Status: Adopted
- Human Maintainer: popcoondev

---

## 1. Framing (Need / Intent / Context)

**Need**: North Star(置く・照らす・撮る・固定画角で見せる + 他者に見せられる)に到達した今、v0.4.0 以降の方向性を決める。

**Intent**: 機能の横拡張ではなく「完成度と信頼」を深める。価値(見せ方の質)と運用(安全・コスト・データ)を両輪にし、非要件(ゲーム化/SNS化/Blender化しない)を守る。

**Context**: v0.3.0 でクラウド保存・共有公開 /s/{id}・安全土台(Rules/App Check/規約/通報)が稼働。Firebase Blaze。ソロ運用・モデレーター不在。AOF を v2.1.0 (organization model) に移行。

---

## 2. Council の判断 (3 Council 並列 → orchestrator 集約)

### Product Council (Visionary)
- 方向 = **「完成度と信頼」**。PRESETS(見せ方の質)+ Phase2.1(運用基盤)を両輪。
- 最重要: **動的OG画像**(/s/{id} を SNS に貼ると絵が出る)= SNS機能を作らずに SNS映え。
- やってはいけない: ギャラリー/いいね/フォロー、Viewer自由移動、Shot のタイムライン・アニメ化(Blender drift)。

### Operations Council (Guardian)
- **GATE-1: Budget アラート**(※ human 設定済 = 充足)。
- **GATE-2: ユーザーあたりシーン数上限**(カウンタドキュメント方式、Functions不要)= 宣伝前必須。
- 続いて: 退会/データ削除(現状 storage.rules `delete:false` で本人すら消せない)、管理スクリプト(Admin SDK)、孤立アセット GC。
- 最重要: Budget なしで宣伝するな(充足済)。

### Architecture Council (Builder)
- シーン数上限 = **S**。ただし `deleteCloudScene` のデクリメントと**同一変更**必須(カウント乖離防止)。
- PRESETS = **S**(`applyHd2dLook` 一般化、env/light/effect 値プリセット。台座ジオメトリは GLB 同梱でビルド増→後送り)。
- 退会/削除 = **M**(Firestore + Auth.delete はクライアント可、Storage 削除は Admin/Functions 必須 → 分割)。
- 動的OG = **L**。Hosting は静的+SPA rewrite で bot は JS 非実行 → per-/s/{id} の OG meta は **Cloud Functions(軽量SSR)が必須**。thumbs/{id}.jpg は既存なので og:image URL は決定論的に作れるが、HTML meta は動的が要る。**Functions 解禁は human 判断**(DR-2026-004 で Phase2.1 送り)。
- 推奨スライス: **シーン数上限+デクリメント + PRESETS** で「運用安全性 + 見た目の価値」を最小で届ける。

---

## 3. 一致点 / 衝突点と裁定 (2_of_3)

**一致点**
- **PRESETS**(Product 価値5 + Builder S)→ IN。
- **シーン数上限**(Guardian GATE + Builder S、Product「信頼」)→ 3_of_3 で IN。`deleteCloudScene` デクリメントと同一変更。
- 退会/削除・孤立GC・管理スクリプトは「成長前に固める Phase2.1」として全 Council 認識。
- やってはいけない進化(SNS化/自由移動/タイムライン化)は非要件と一致。

**衝突点と裁定**
1. **動的OG**: Visionary 最重要 ↔ Builder「L、Functions 解禁が前提」。Guardian は中立。
   → **裁定: escalate to maintainer**。動的OG は次の高価値だが、Cloud Functions 導入(運用面積・コスト増、DR-2026-004 で Phase2.1 送り)の可否は human の判断。決まれば専用スライスで着手。
2. **価値 vs 安全のどちらを先に**: Product は価値、Guardian は安全。
   → **裁定 (Builder 橋渡し)**: v0.4.0 に **両方**入れる。シーン数上限(安全・S)+ PRESETS(価値・S)を1スライスに。

---

## 4. 優先順位付き方向性 (v0.4.0 以降)

1. **TASK-015 シーン数上限 + 削除デクリメント** (S, Operations) — 課金/データの天井。宣伝前 GATE。
2. **TASK-016 PRESETS** (S, Product) — 展示台/背景/ライトリグの env/light/effect 値プリセット。
3. **TASK-017 退会/データ削除 (クライアント部分)** (M, Operations) — Firestore 自分のシーン一括削除 + Auth.delete。Storage は管理スクリプトへ。
4. **TASK-018 動的OG (要 Functions 解禁判断)** (L, Product) — escalated。human が Functions 可否を決めてから。
5. backlog: MOBILE Viewer (S) / MULTISHOT 単純切替のみ (S, 補間=Blender drift で不可) / FXMORE (M) / 管理スクリプト+孤立GC (Phase2.1)。

---

## 5. Current Operating Goal / Next Value Slice

- **Operating Goal**: プロダクトを「完成度と信頼」で深める — 運用の天井(課金/データ)と見せ方の質(プリセット)を両輪で固め、共有の到達(動的OG)は human の Functions 判断のうえで開く。
- **Next Value Slice (v0.4.0)**: 「安全と質」— TASK-015(シーン数上限+デクリメント)+ TASK-016(PRESETS)。Functions 不要・ソロで完結・非要件遵守。

## 6. Escalation (maintainer 判断待ち)
- **Cloud Functions を解禁するか?**(動的OG / Storage 削除 / 孤立GC の前提)。コスト・運用面積が増えるため maintainer が決める。

## 7. 次に誰が何を (organization)
| 担当 (role / team) | アクション |
|---|---|
| **Builder / cloud-team** | TASK-015 実装(Rules カウンタ + saveSceneToCloud / deleteCloudScene の batch 同時更新) |
| **Builder / scene-team** | TASK-016 PRESETS(`src/presets.ts` + Scene タブ UI、applyHd2dLook 一般化) |
| **Operations Council** | TASK-015 の Rules レビュー、退会フロー(TASK-017)の設計 gate |
| **Maintainer (popcoondev)** | Cloud Functions 解禁の可否(動的OG / Storage 削除のため)を判断 |

---

## Project Note
AOF v2.1.0 managed-project。organization は `.aof/organization.json`。本 DR と `.aof/` 更新は maintainer の指示による。
