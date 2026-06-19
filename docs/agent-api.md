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
| `updateObject` | write | `{ sceneId, objectId, position?, rotation?, scale? }` | `{ ok, sceneId, objectId, objectCount }` |
| `removeObject` | write | `{ sceneId, objectId }` | `{ ok, sceneId, removed, objectCount }` |
| `setCamera` | write | `{ sceneId, position?, target?, focalLength? }` | `{ ok, sceneId, position, target }` |
| `addLight` | write | `{ sceneId, kind?, color?, intensity?, position?, castShadow? }` | `{ ok, sceneId, lightId, lightCount }` |
| `updateLight` | write | `{ sceneId, lightId, color?, intensity?, position?, castShadow? }` | `{ ok, sceneId, lightId }` |
| `removeLight` | write | `{ sceneId, lightId }` | `{ ok, sceneId, removed, lightCount }` |

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

- **視覚フィードバック無し**: エージェントは結果を「見られない」。`getScene` の構造から幾何で
  推論する。将来サムネ/レンダリング返却を検討(重い・別タスク)。
- GLB のサイズ正規化・画像 aspect のライブラリ保存は将来改善(現状 aspect 既定 1)。
