# Decision Record: DEC-MQJ5KB8K-QP4AA4

- Record Format Version: 1.0.0
- Created At: 2026-06-18T07:02:33.956Z
- Canonical Markdown Path: .aof/decisions/DEC-MQJ5KB8K-QP4AA4.md

## Scope
- Record Format Version: 1.0.0
- Created At: 2026-06-18T07:02:33.956Z
- Canonical Markdown Path: .aof/decisions/DEC-MQJ5KB8K-QP4AA4.md
- Scope: slice-scope-approval
- Stage: clarification
- Organization: Pixel Showcase Studio

## Input
- Request: v0.7.2 までの現在地を総括し、次リリース v0.8.0 への進化ポイントを整理する。非要件(ゲーム化しない/Viewer自由移動なし/Blender化しない/操作の自然さと見せ方品質を優先)を守りつつ、最近の動きループ(カメラ/オブジェクト)・GIFループ・ライト発光ループという『動き・リッチさ』の系譜を次の価値スライスにつなぐ。
- Need: 改善対象と範囲: v0.8.0は『動き・リッチさ』系譜の収れん。候補=動きループのプリセット&イージング&位相同期(複数ライト/オブジェクトの連動)、ライト発光の色サイクル、エフェクトと動きの連動、公開Viewerでの一貫再生。範囲は編集UIとViewer再生まで。新バックエンド/サーバー動画保存/認証変更は範囲外。
- Intent: to be refined after clarification
- Context: context: 守る制約: 非要件4つ(ゲーム化しない/Viewer自由移動なし/Blender的な重DCCにしない/機能追加より操作の自然さと見せ方品質を優先)。固定画角Viewer(viewerLocked)の編集不可前提、Scene JSON v2のアセット重複排除(hashDataUrl/serialize/migrate)、store.tsのUndo/スナップショット、サーバーに動画保存はしない方針。push/release/publishはhuman(popcoondev)承認。既存の動きループ/GIF/発光ループのデータ後方互換(optionalフィールド)を壊さない。 / 改善対象と範囲: v0.8.0は『動き・リッチさ』系譜の収れん。候補=動きループのプリセット&イージング&位相同期(複数ライト/オブジェクトの連動)、ライト発光の色サイクル、エフェクトと動きの連動、公開Viewerでの一貫再生。範囲は編集UIとViewer再生まで。新バックエンド/サーバー動画保存/認証変更は範囲外。 | prohibited: 守る制約: 非要件4つ(ゲーム化しない/Viewer自由移動なし/Blender的な重DCCにしない/機能追加より操作の自然さと見せ方品質を優先)。固定画角Viewer(viewerLocked)の編集不可前提、Scene JSON v2のアセット重複排除(hashDataUrl/serialize/migrate)、store.tsのUndo/スナップショット、サーバーに動画保存はしない方針。push/release/publishはhuman(popcoondev)承認。既存の動きループ/GIF/発光ループのデータ後方互換(optionalフィールド)を壊さない。
- Existing Artifacts Reviewed: none
- Background or Prior Decisions: clarification completed in session SESS-MQJ5JV1L-BOSC1N
- Clarifications or Assumptions: 今回、変更してはいけない制約や既存要素はありますか => 守る制約: 非要件4つ(ゲーム化しない/Viewer自由移動なし/Blender的な重DCCにしない/機能追加より操作の自然さと見せ方品質を優先)。固定画角Viewer(viewerLocked)の編集不可前提、Scene JSON v2のアセット重複排除(hashDataUrl/serialize/migrate)、store.tsのUndo/スナップショット、サーバーに動画保存はしない方針。push/release/publishはhuman(popcoondev)承認。既存の動きループ/GIF/発光ループのデータ後方互換(optionalフィールド)を壊さない。 / 今回、何を改善対象とし、どの範囲までを扱いますか => 改善対象と範囲: v0.8.0は『動き・リッチさ』系譜の収れん。候補=動きループのプリセット&イージング&位相同期(複数ライト/オブジェクトの連動)、ライト発光の色サイクル、エフェクトと動きの連動、公開Viewerでの一貫再生。範囲は編集UIとViewer再生まで。新バックエンド/サーバー動画保存/認証変更は範囲外。
- Clarification Summary Optional: runtime は初回の clarification 回答を取り込み、need validation に進める状態になった
- Unresolved Ambiguity Optional: 

## Options Considered
- Option A: Create need validation artifacts before planning
- Option B: Advance directly to planning
- Option C: Stop until more evidence exists

## Decision
- Selected Option: Create need validation artifacts before planning
- Decision Summary: Clarification has produced a usable frame, but planning must wait for need validation and project charter evidence.

## Governance
- Governance Model: councils
- Decision Makers: visionary-01 (Visionary), guardian-01 (Guardian)
- Governance Rule Applied: 2_of_3 # v2.1.0 既定。hard-coded law ではなく override 可能な policy
- Veto Used: No

## Rationale
- Why this option: A framed request is not yet a validated need, so project creation and planning remain gated.
- Why other options were not selected: Direct planning would bypass the need validation policy, and stopping completely would discard a usable frame.
- Policy priorities applied: value > safety > quality > speed > cost
- Policy tradeoffs accepted: speed is deferred until the underlying problem and value claim are validated

## Execution
- Actions: write problem statement and value hypothesis artifacts
- Actions: record alternatives and any required experiment
- Actions: produce a need validation record and project charter before planning
- Expected Artifact: need validation artifact set and project charter
- Expected Outcome: planning only starts after a validated need exists
- Completion Criteria: approved need validation record and project charter are linked into the session
- Success Criteria: the next planning step is grounded in a validated need rather than a raw request
- Completion Approval Scope: slice-scope-approval
- Success Evaluation Scope: need validation gate review

## Forecast Optional
- Forecast Required: false
- Forecast Summary: not required before need validation completes
- Uncertainty Notes: the stated request may still be reframed, deferred, or rejected

## Actor Notes Optional
- Actor Performance Notes: not evaluated yet
- Capacity Notes: not evaluated yet
- Fit Notes: Visionary and Guardian judgment is required before Builder-led planning begins
- Protocol Thread ID: SESS-MQJ5JV1L-BOSC1N

## Routing Optional
- Routing Mode: deep-path
- Max Retries: 2
- Escalation Target: human-maintainer
- Context Snapshot ID: CTX-MQJ5KB8I-YUWIOA

## Review
- Change Trigger: clarification answers completed the initial frame
- Review Trigger: when a need validation record and project charter are produced
- Review Date or Condition: before planning starts
- Re-open Conditions: weak evidence, invalid value hypothesis, missing alternatives, or rejected project recommendation

## Escalation Optional
- Escalation Status: none
- Escalation Summary: none
- Approval Outcome Status: none
- Guardian Veto Used Optional: none
- Escalation Resolution: none
- Escalation Resolution Note: none

---

Project Note:
This generic starter keeps the same runtime shell but uses a non-AIDLC workflow.
