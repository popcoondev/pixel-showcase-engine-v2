# Decision Record: DR-2026-009 — エージェント編集API + MCP ゲートウェイ

- Record Format Version: 1
- Created At: 2026-06-18
- Framework: AOF v3.5.0
- Governance: councils / 2_of_3(外部**書き込み**サーフェス=Operations/Guardian の安全審査、Guardian veto 水準)
- Builds on: DR-2026-008(外部生成API=read+1ショット生成)
- Status: Adopted(資格情報の渡し方は human が案A=MCP ゲートウェイにラチファイ)
- Human Maintainer: popcoondev

---

## 1. Framing (Need / Intent / Context)

**Need**: 外部AI/エージェント(Claude 等)が、1ショット生成だけでなく **手順を踏んで編集**できるようにする。具体的に「アセット一覧取得 / シーン状態取得 / アセット配置」を道具として呼びたい。

**Intent**: `getScene → placeAsset×N → 公開` をエージェントで回せる、ステートレスな道具箱。状態はクラウドのシーン doc に置く(道具は read-modify-write)。非要件(ゲーム化/自由移動/Blender化/SNS化しない)を守る。

**Context**: DR-2026-008 で read+生成の callable(App Check 非enforce・uid 自損・上限)を確立済。今回は**外部からの任意書き込み(配置)**=攻撃面・コスト・書き込み妥当性の審査をやり直す必要がある。

---

## 2. 決定

**(a) 資格情報の渡し方 = MCP ゲートウェイ(案A)**。maintainer が動かす MCP サーバーが Firebase 資格情報を保持し、ツール(list/get/place)を Claude に公開する。**Claude は生のトークンを見ない**(ベアラ漏洩を回避)。MCP サーバーは「自分の uid 用 ID トークン」を取得して callable を叩く薄いアダプタ。

**(b) API = uid 自損スコープの callable Function 3本(+下書き作成)**:
- `listAssets` (read): `users/{uid}/assets` を返す。
- `getScene(sceneId)` (read): `users/{uid}/showcases/{sceneId}` の scene/assetRefs を返す。`createDraftScene` で空シーン(三灯+env+camera)も作れる。
- `placeAsset(sceneId, hash, {position,rotation,scale})` (**write**): 本人の library にある hash を、本人のシーンに1個追加して保存(read-modify-write)。kind は asset doc から決定。
- 状態は常にクラウドのシーン doc。Function は単一の真実=ルール/上限の実装箇所。

---

## 3. Guardian 条件(write サーフェスゆえの追加)

1. すべて呼び出し元 uid 自身の library/showcases のみ(他人のデータ read/write 禁止)。`sceneId` は `users/{uid}/showcases/{id}` パスで本質的にスコープ。
2. **書き込み妥当性検証**: `hash` は本人の library に存在必須。position は ±50m、scale は 0.01〜50、配列長3・有限数のみ。range 外はクランプ/拒否。
3. **上限**: 1シーンの object 上限(300)/ シーン数20 / 1日あたり書き込み操作上限(既定500、`aiOpCount`/`aiOpDate` で日次リセット)。上限なし実装は不可。
4. **公開しない**: この API 群は作業コピーのみ。公開(showcases/ 昇格)は別の既存フロー=別ゲート。
5. App Check 非enforce はこの API 群のみ。クライアントの強制は温存。
6. Functions / MCP サーバーのデプロイ・起動は human。service-account JSON / 秘密鍵はリポジトリに置かない。cadence 自動デプロイ禁止。

---

## 4. 実装スライス

- スライス1(本DR・先行): `functions/index.js` に `listAssets` / `getScene` / `createDraftScene` / `placeAsset`。検証 + 上限。
- スライス2: MCP サーバー(maintainer 運用)= 資格情報保持 + 上記を MCP ツールとして公開。Claude は MCP 経由で操作。
- 既存 `createSceneFromAssets`(1ショット)は残置。エージェントは「composeで下書き → place で微調整」も可能。
- TASK-035(スライス1)/ TASK-036(スライス2 MCP)。
