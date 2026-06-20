# エージェント編集 API 契約 (DR-2026-009)

外部 AI/エージェントがアカウントのアセットから展示シーンを **手順を踏んで** 組むための API。
すべて **callable Cloud Function**(gen2 / `asia-northeast1`)。状態はクラウドのシーン doc
(`users/{uid}/showcases/{sceneId}`)に置き、各ツールは read-modify-write。

この契約が **MCP ツールの JSON Schema の単一の出所**。OpenAPI は使わない(callable は RPC、
かつ消費者は MCP クライアント=Claude / Codex / その他)。MCP サーバーは下表をそのまま
ツール定義に写す。

## 共通

- **認証**: Firebase ID トークン(callable が `request.auth.uid` で検証)。App Check は非 enforce。
- **スコープ**: 呼び出し元 `uid` 自身の `assets` / `showcases` のみ。他人のデータには触れない。
- **公開しない**: これらは作業コピー(`users/{uid}/showcases`)のみ。公開(`showcases/` 昇格)は対象外。
- **上限**: 1シーン object 300 / アカウント シーン 20 / 書き込み操作 500 回/日。
- **エラー**(HttpsError code): `unauthenticated` / `invalid-argument` / `not-found` /
  `failed-precondition`(アセット未所有 等)/ `resource-exhausted`(上限)。

## 型

```
Vec3   = [number, number, number]            // position(m, ±50) / rotation(rad) / scale(0.01–50)
Asset  = { hash: string, name: string, kind: 'glb'|'image', aspect: number|null }
SceneObject = { id, name, kind:'cube'|'plane'|'glb', position, rotation, scale, material, glbAssetId? }
Scene  = { version, name, objects: SceneObject[], lights, env, camera, shots, activeShotId }
```

## ツール

| ツール | 種別 | 入力 | 出力 |
|---|---|---|---|
| `listAssets` | read | （なし） | `{ ok, assets: Asset[] }` |
| `getScene` | read | `{ sceneId }` | `{ ok, sceneId, name, scene: Scene, assetRefs }` |
| `createDraftScene` | write | `{ name? }` | `{ ok, sceneId }` |
| `placeAsset` | write | `{ sceneId, hash, position?, rotation?, scale? }` | `{ ok, sceneId, objectId, objectCount }` |
| `placeAssets` | write | `{ sceneId, items: [{hash, position?, rotation?, scale?}] }`(最大50) | `{ ok, sceneId, objectIds, placed, skipped, objectCount }` |
| `updateObject` | write | `{ sceneId, objectId, position?, rotation?, scale? }` | `{ ok, sceneId, objectId, objectCount }` |
| `removeObject` | write | `{ sceneId, objectId }` | `{ ok, sceneId, removed, objectCount }` |
| `setCamera` | write | `{ sceneId, position?, target?, focalLength? }` | `{ ok, sceneId, position, target }` |
| `addLight` | write | `{ sceneId, kind?, color?, intensity?, position?, castShadow? }` | `{ ok, sceneId, lightId, lightCount }` |
| `updateLight` | write | `{ sceneId, lightId, color?, intensity?, position?, castShadow? }` | `{ ok, sceneId, lightId }` |
| `removeLight` | write | `{ sceneId, lightId }` | `{ ok, sceneId, removed, lightCount }` |
| `setCameraMotion` | write | `{ sceneId, enabled?, yawDeg?, pitchDeg?, dolly?, speed?, easing?, phase? }` | `{ ok, sceneId, motion }` |
| `setObjectMotion` | write | `{ sceneId, objectId, enabled?, moveX?, moveY?, moveZ?, spinY?, speed?, easing?, phase? }` | `{ ok, sceneId, objectId, motion }` |
| `setLightPulse` | write | `{ sceneId, lightId, enabled?, mode?, min?, speed?, easing?, phase? }` | `{ ok, sceneId, lightId, pulse }` |
| `setLightColorCycle` | write | `{ sceneId, lightId, enabled?, mode?, hueRange?, colors?, speed?, phase? }` | `{ ok, sceneId, lightId, colorCycle }` |
| `listScenes` | read | （なし） | `{ ok, scenes: [{sceneId, name, objectCount, updatedAt}] }` |
| `renameScene` | write | `{ sceneId, name }` | `{ ok, sceneId, name }` |
| `duplicateScene` | write | `{ sceneId, name? }` | `{ ok, sceneId, name }` |
| `deleteScene` | write | `{ sceneId }` | `{ ok, sceneId, deleted }` |
| `render_scene` | read | `{ sceneId }` | PNG 画像(MCPサーバー側でヘッドレス描画。Function ではない) |
| `importAsset` | write | `{ dataUrl, name?, kind?, aspect? }` | `{ ok, hash, kind, aspect, reused }` |

補足:
- `placeAsset` の `hash` は `listAssets` の `Asset.hash`。`kind`/`aspect` はサーバが asset から決定。
- `updateObject` は `position`/`rotation`/`scale` のみ変更可(kind/material/参照は不変)。
- 入力の数値は範囲外をクランプ(position ±50 / scale 0.01–50)。
- 1ショット生成 `createSceneFromAssets({ name?, turntable?, assetHashes? }) → { ok, sceneId, objectCount }`
  も残置。エージェントは「これで下書き → `updateObject`/`placeAsset` で微調整」も可。
- `setCamera` は **アクティブ Shot** の位置/注視点を更新し quaternion を再計算する(焦点距離 10–200mm)。
- `addLight` の kind=`directional`/`point`/`spot`、intensity 0–200(既定 dir3/point50/spot80)、最大16灯。
- `placeAsset`/`compose` は配置時に **ライブラリの既定スケール(defaultScale)/色味(tint)/aspect** を適用する
  (明示の `scale` があればそちら優先)。これらは UI の「☁ライブラリ → 設定」で human が編集する。
- `importAsset` は **AI 生成画像/GLB をライブラリに取り込む**(`dataUrl` = `data:<mime>;base64,<...>`)。
  content-hash で重複排除、PNG は縦横比を自動取得、上限 ~12MB(callable のため)。返った `hash` を
  `placeAsset` に渡せば「生成 → 取り込み → 配置」が MCP だけで完結する。
- **動きループ(v0.8.0)** は patch 適用(未指定フィールドは現状維持)。`setCameraMotion`=オービット/弧/寄り引き、
  `setObjectMotion`=各軸振幅+`spinY`(ターンテーブル 度/秒)、`setLightPulse`=明滅(`mode` pulse/blink/flicker)、
  `setLightColorCycle`=色巡回(`mode` hue/gradient、gradient は `colors` 2〜4色)。`easing`=linear/easeInOut/easeIn/easeOut、
  `phase`(0-1)で別ライトと交互/連動。数値は範囲外クランプ。
- **シーン管理**: `listScenes`(一覧)/`renameScene`/`duplicateScene`(シーン上限20を尊重)/`deleteScene`。
  `deleteScene` は作業コピーのみ削除し、公開済みスナップショット(`showcases/`)には触れない。

## 典型フロー

```
listAssets()                                  // 何があるか
sceneId = createDraftScene({ name: '個展A' }) // 空シーン
placeAsset(sceneId, hashA, { position:[-2,0,0] })
placeAsset(sceneId, hashB, { position:[ 2,0,0] })
getScene(sceneId)                             // 現状を読んで次の判断
updateObject(sceneId, objId, { position:[2,0.5,0] })
// 確認/公開は人間が UI で(☁開く → Publish)
```

## 既知の制約

- **公開は対象外**: 作業コピーまでを MCP で扱う。公開(`showcases/` 昇格)は独自の DR が必要(別ゲート)。
- 編集 Function は read-modify-write(未トランザクション)。同一シーンへの **同時書き込み** は lost-update の
  可能性(TASK-041 でトランザクション化予定)。単独エージェント利用では問題にならない。
