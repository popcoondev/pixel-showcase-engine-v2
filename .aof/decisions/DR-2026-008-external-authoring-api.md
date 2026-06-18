# Decision Record: DR-2026-008 — 外部AI/エージェント向けシーン生成API

- Record Format Version: 1
- Created At: 2026-06-18
- Framework: AOF v3.5.0(need-validation ゲート → DR)
- Governance: councils / 2_of_3(外部サーフェス=Operations/Guardian の安全審査、Guardian veto 水準)
- Need Validation: `NVR-MQJJET7J`(experiment-required → 実験 TASK-034 成功 → create-project-after-experiment 充足)
- Status: Adopted(認証方式は human maintainer がラチファイ=案A)
- Human Maintainer: popcoondev

---

## 1. Framing (Need / Intent / Context)

**Need**: アカウントに貯めたアセット(GLB/画像)を、外部の AI/エージェントがプログラムから取得し、新しい展示シーンを生成・保存できるようにする(元要望「これをAIからもできるように」)。

**Intent**: 見せ方品質を保ったまま展示を量産・自動化する。非要件(ゲーム化/自由移動/Blender化/SNS化しない、操作の自然さ優先)を守る。生成ロジックは TASK-034 実験で検証済みの `composeScene` を踏襲。

**Context**: クライアントは reCAPTCHA Enterprise App Check を強制中。プログラム的クライアントは reCAPTCHA を解けないため、既存クライアント経路では外部から叩けない。Firebase Blaze 従量課金・ソロ運営。シーン数上限20(TASK-015)が稼働中。

---

## 2. 決定(2_of_3 / Guardian 条件付き)

**外部サーフェスは Cloud Function 1本に限定し、そこを信頼境界とする(案A)。**

- **認証**: callable Function `createSceneFromAssets`(gen2, asia-northeast1)。`request.auth.uid`(Firebase ID トークン)で認証。外部エージェントは信頼サーバで custom token をミント→ID トークンで呼ぶ。**この Function は App Check を enforce しない**(プログラム的クライアントを許すため)。クライアントSDKの App Check 強制は**温存**(既存の攻撃面は不変)。
- **権限**: Function は Admin で実行し、**呼び出し元 uid 自身のデータのみ**操作(library 読取 + 自分の showcases に保存)。abuse は自損に限定(purgeMyData と同じ境界)。
- **処理**: `users/{uid}/assets` を読む → サーバ側 compose(クライアント `composeScene` と同じ配置規則を three 非依存で実装)→ `users/{uid}/showcases/{id}` に `scene`(assets 除く)+ `assetRefs`(hash→assets/{hash})を保存。公開はしない(公開は別の既存フロー=別ゲート)。
- **濫用/コスト対策**: ① 既存のシーン数上限20を Function 側でも検査 ② 1日あたり生成上限(既定20/日、`users/{uid}` の `aiGenCount`/`aiGenDate` で日次リセット)③ 入力アセット数の上限(例: 50)。

---

## 3. Guardian 条件(veto 解除条件)

1. App Check 非enforce はこの1 Function のみ。他のクライアント/Function には波及させない。
2. Function は呼び出し元 uid 以外のデータに一切触れない(他人の library/showcases を読まない・書かない)。
3. 日次生成上限 + シーン数上限 + 入力数上限を必ず通す(コスト/濫用の上限を持たない実装は不可)。
4. 公開(showcases/ への昇格)はこの Function では行わない。生成は「作業コピー」止まり。
5. Functions デプロイは human が手動(`firebase deploy --only functions`)。cadence 自動デプロイ禁止。

---

## 4. 却下した代替

- **案B サーバ間(サービスアカウント)**: 公開口なしで最小攻撃面だが「外部から誰でも(オーナー認証で)」を満たさず、オーナー運用前提に閉じる。将来の選択肢として保持。
- **案C per-user API キー**: 汎用だが鍵発行/失効/濫用監視の運用コストが現段階(ソロ運営)に見合わない。需要が育てば再検討。

---

## 5. 実装スライス

- `functions/index.js` に `createSceneFromAssets`(認証 + library 読取 + compose + 上限検査 + 保存)。
- 配置規則は `src/experiments/composeScene.ts` と整合(three 非依存で port)。
- クライアント/エージェント向け呼び出し手順を docs 化。
- TASK-033 = 本 DR の実装。デプロイは human。
