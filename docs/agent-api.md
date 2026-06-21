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
| `setEnvironment` | write | `{ sceneId, groundVisible?, gridVisible?, backgroundColor?, groundColor?, fogEnabled?, fogColor?, fogNear?, fogFar?, bloomEnabled?, bloomIntensity?, vignetteEnabled?, vignetteDarkness?, ambientColor?, ambientIntensity? }` | `{ ok, sceneId, env }` |
| `setCameraMotion` | write | `{ sceneId, enabled?, yawDeg?, pitchDeg?, dolly?, speed?, easing?, phase? }` | `{ ok, sceneId, motion }` |
| `setObjectMotion` | write | `{ sceneId, objectId, enabled?, moveX?, moveY?, moveZ?, spinY?, speed?, easing?, phase? }` | `{ ok, sceneId, objectId, motion }` |
| `setLightPulse` | write | `{ sceneId, lightId, enabled?, mode?, min?, speed?, easing?, phase? }` | `{ ok, sceneId, lightId, pulse }` |
| `setLightColorCycle` | write | `{ sceneId, lightId, enabled?, mode?, hueRange?, colors?, speed?, phase? }` | `{ ok, sceneId, lightId, colorCycle }` |
| `listScenes` | read | （なし） | `{ ok, scenes: [{sceneId, name, objectCount, updatedAt}] }` |
| `renameScene` | write | `{ sceneId, name }` | `{ ok, sceneId, name }` |
| `duplicateScene` | write | `{ sceneId, name? }` | `{ ok, sceneId, name }` |
| `deleteScene` | write | `{ sceneId }` | `{ ok, sceneId, deleted }` |
| `render_scene` | read | `{ sceneId, shotId? }` | PNG 画像(shotId でその視点から描画。MCPサーバー側でヘッドレス描画) |
| `measure_scene` | read | `{ sceneId }` | `{ objects: {id:{name,kind,size,center}}, bounds }`(各オブジェクトの実寸 m。MCPサーバー側で計測) |
| `publish_scene` | write | `{ sceneId, approvalToken, title?, author? }` | `{ ok, sceneId, publishId, url }` |
| `unpublish_scene` | write | `{ sceneId }` | `{ ok, sceneId, unpublished }` |
| `importAsset` | write | `{ dataUrl, name?, kind?, aspect? }` | `{ ok, hash, kind, aspect, reused }` |
| `import_asset_file` | write | `{ path, name?, kind? }`（MCPサーバ側でファイルを読む。Function ではない） | `importAsset` と同じ |

補足:
- `placeAsset` の `hash` は `listAssets` の `Asset.hash`。`kind`/`aspect` はサーバが asset から決定。
- `updateObject` は `position`/`rotation`/`scale` のみ変更可(kind/material/参照は不変)。
- 入力の数値は範囲外をクランプ(position ±50 / scale 0.01–50)。
- 1ショット生成 `createSceneFromAssets({ name?, turntable?, assetHashes? }) → { ok, sceneId, objectCount }`
  も残置。エージェントは「これで下書き → `updateObject`/`placeAsset` で微調整」も可。
- `setCamera` は **アクティブ Shot** の位置/注視点を更新し quaternion を再計算する(焦点距離 10–200mm)。
- `addLight` の kind=`directional`/`point`/`spot`、intensity 0–200(既定 dir3/point50/spot80)、最大16灯。
- `setEnvironment` は env の **patch**(未指定は不変)。**床/グリッドを消すには `groundVisible:false` /
  `gridVisible:false`**。色は `#rgb`/`#rrggbb` のみ採用(不正は無視)、数値は範囲クランプ。
  新規シーンの既定は地面 ON・グリッド OFF。UI(Scene パネル)/公開ビューも同じ env を尊重する。
- `placeAsset`/`compose` は配置時に **ライブラリの既定スケール(defaultScale)/色味(tint)/aspect** を適用する
  (明示の `scale` があればそちら優先)。これらは UI の「☁ライブラリ → 設定」で human が編集する。
- `importAsset` は **AI 生成画像/GLB をライブラリに取り込む**(`dataUrl` = `data:<mime>;base64,<...>`)。
  content-hash で重複排除、PNG は縦横比を自動取得、上限 ~12MB(callable のため)。返った `hash` を
  `placeAsset` に渡せば「生成 → 取り込み → 配置」が MCP だけで完結する。
- **base64 をツール引数で渡すと truncate する**(モデルの文脈を通るため末尾が欠ける)。大きな画像は
  **`import_asset_file`(ローカルパス)を使う**こと。MCP サーバがファイルを読んで base64 化するので
  巨大データがモデル文脈を通らず壊れない。AI 生成画像は一旦ファイルに保存 → `import_asset_file` が定石。
- `importAsset` は保存前に**整合性チェック**を行う: PNG=IEND 終端 / JPEG=EOI(FFD9) / WEBP=RIFF サイズ /
  GIF=トレーラ / GLB=ヘッダ宣言長。切断・破損は `invalid-argument`「壊れたアセット: …」で弾く
  (黙って空テクスチャを保存して「配置したのに見えない」を防ぐ)。
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

- **公開(DR-2026-010)**: `publish_scene` は **人間が発行した使い捨て承認トークン必須**。トークンは
  human がアプリの「☁開く → 🤖承認」で発行(`issuePublishToken` は App Check enforce =ブラウザのみ)。
  エージェントはトークンを発行できず(App Check 無し)、`publishApprovals` も Firestore default-deny で
  直書き不可。承認1回で公開実行=MCP 完結。`unpublish_scene` は承認不要(安全側)。公開上限 20/日。
- `measure_scene` は GLB の正規化後の**実寸(ワールド境界ボックス, m)**を返す。`get_scene` の `scale` は
  GLB では正規化に対する倍率で実寸ではないため、大小判断には `measure_scene` を使う。`render_scene` の
  `shotId` は `list_shots` の id(その視点を固定表示。ツアーは一時無効化)。
- シーン編集 Function は **Firestore トランザクション**で実行(TASK-041)。同一シーンへの同時書き込みは
  競合時に自動リトライされ、lost-update(取りこぼし)が起きない。複数エージェント/人間同時編集でも安全。
