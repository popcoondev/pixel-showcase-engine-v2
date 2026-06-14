# Decision Record: DR-2026-007 — 次の方向性(データライフサイクル整備)

- Record Format Version: 1
- Created At: 2026-06-14
- Framework: AOF v2.4.0(execution packet 連鎖を明示)
- Governance: councils / 2_of_3
- Execution Lineage: `.aof/execution/lineage/LINEAGE-2026-0614-next-direction.json`
- Status: Adopted(human のエスカレーション2件は実装前に確定)
- Human Maintainer: popcoondev

---

## 1. Framing (Need / Intent / Context)

**Need**: v0.5.1 で North Star(置く・照らす・撮る・固定画角・SNSで見せる)到達。次の1サイクルの方向を「機能改善 / バグ回収 / 新機能 / 管理系」から選ぶ。

**Intent**: 完成度を上げる段階として、最もレバレッジの高い方向に張る。非要件(ゲーム化/自由移動/Blender化/SNS化しない、操作の自然さ優先)を守る。

**Context**: 公開機能稼働中(Firebase Blaze 従量課金、ソロ運営)。解析/Sentry が入りたてで実利用データはこれから。既知バグ無し。

---

## 2. v2.4 Execution Packets(role-result → council-review)

3ロールの role-result を `.aof/execution/role-results/` に記録。要旨:

| role | 推す方向 | confidence | decision_required |
|------|---------|:--:|---|
| Visionary | 1 機能改善(ただしデータ待ち) | medium | データウォッチ vs 今すぐ仮説改善 |
| Builder | 4 管理系(退会時 Storage 削除 Function, M) | high | GC 戦略(thumbs即時 + assets定期GC) |
| Guardian | 4 管理系(veto 水準) | high | EU/GDPR 公開範囲 |

council-review packet: `.aof/execution/council-reviews/CR-2026-0614-next-direction.json`(review_status=decided, escalation_required=true)。

---

## 3. 集約(2_of_3)と裁定

**2_of_3 で 方向4「管理系=データライフサイクル整備」を採択**(Builder + Guardian, ともに high)。理由:
- 退会・削除しても **Storage 実体(assets/{hash}, thumbs)が残る**(storage.rules `delete:false`)。ユーザー数に依らず**単調増加**=コスト漸増、放置で清算コストが**非線形に増大**。
- **GDPR 削除権の不履行**(規約整備済でも実装が追わねば法的リスク)。Guardian は veto 水準。
- **データ不要で今判断できる**負債(機能改善はデータ前提=今は当て推量)。

**Visionary の機能改善は衝突ではなく順序**: 本人が medium・「機能判断は後でできる/データ待ち」と明言。→ **今サイクル=ライフサイクル整備、次サイクル=データ駆動の機能改善**。解析/Sentry のデータは今サイクル中に並行蓄積する。

---

## 4. 決定

- **Current Operating Goal**: 「公開した展示の**データを最後まで責任持って扱える**(保存・公開・**完全削除**)」状態にする。
- **Next Value Slice**: 退会時の Storage 完全削除 + 孤立アセット GC。
  - **TASK-019** 退会時の Storage 削除(Cloud Function)— thumbs は即時、assets は GC へ
  - **TASK-020** 孤立アセット GC(参照0の content-hash を定期削除、Cloud Scheduler)
  - **TASK-021** 解析/Sentry を2〜3週間ウォッチ(次サイクルの機能改善の入力)— 並行・受動

## 5. Escalation(human 判断、実装前に確定)
1. **EU/GDPR 公開範囲**(Guardian): 事実上グローバル公開か(GDPR 適用=今すぐ必須)/ EU 遮断か(優先度中)。
2. **GC 戦略**(Builder): 「退会時に thumbs/{自分の公開} を即時削除 + assets/{hash} は参照0を定期 GC」の二段階方針を採るか。content-hash 共有のため、退会時に assets を即削除すると他ユーザー参照を壊すリスク → 二段階が安全。

## 6. 次に誰が何を
| 担当 | アクション |
|---|---|
| Maintainer | 上記エスカレーション2件を確定(EU範囲 / GC二段階方針) |
| Builder / cloud-team | TASK-019 退会時 Storage 削除 Function |
| Builder | TASK-020 孤立アセット GC(Scheduler) |
| Operations Council | GC の安全性(誤削除防止)と Function が公開コレクションのみ読むことを確認 |
| (受動) | TASK-021 解析/Sentry ウォッチ → 次サイクルで機能改善を再 framing |
