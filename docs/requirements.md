# Pixel Showcase Engine 要件定義書

## 目的

Pixel Showcase Engine は、ドット絵・GLB/GLTF・画像プレートを3D空間に配置し、固定画角の展示ビューとして見せるためのWebオーサリングツールである。ゲームを作るのではなく、「置く・照らす・撮る・固定画角で見せる」を気持ちよく成立させるのが主目的である。

## 必要な体験

制作フローは `Edit -> Camera -> Save Shot -> Preview`。

- `Edit` ではオブジェクトやライトや地面や背景を調整する
- `Camera` では構図と露出と被写界深度を詰める
- `Preview` では保存した Shot を固定表示して確認する
- Viewer は自由移動できず、決めた画角だけを見せる

## 機能要件

### 3Dシーン編集

- GLB/GLTF 読み込み
- Cube / Plane 追加
- 画像テクスチャ貼り付け
- オブジェクト選択、移動、回転、拡大縮小
- 均等スケール数値入力
- Material の質感変更
- Emissive / Rim っぽい表現

### ライティング

- ライト追加、削除
- 色、強さ、方向、影の調整
- Ambient / Fog / Bloom を含む look-dev
- HD-2D 風の見せ方を作れる調整幅

### カメラ / 撮影

- カメラ位置、向き、FOV、Exposure
- DOF の有効/無効
- Focus Mode: `Subject / Manual / Screen Point`
- Aperture と Focal Length 中心の実カメラ寄りUI
- 固定フレーム比表示
- Shot 保存

### Preview / 出力

- 保存した Shot の固定表示
- Viewer で編集不可
- PNG 保存
- WebM 録画

### データ保存

- Scene JSON 保存 / 読み込み
- Shot / Presentation 分離
- Viewer slug 管理

## UI / 操作要件

- できるだけキャンバス中心で触れる
- カメラ周りは初心者にも分かる言葉にする
- 実カメラに近い操作感へ寄せる
- キャンバス外周のクイック操作
  - 下: `Aperture`
  - 左: `FOV`
  - 右: `Exposure`
- 上部タブで `Edit / Scene / Camera / Object / Light` を切り替える
- `ESC` で `Edit` と `Camera` を切り替える
- `R` で `Save Shot`
- `P` で `Preview`

## 表現面で重視するもの

- 構図
- ミニチュア感
- プレート感
- ドット絵の色を壊さずに素材感だけを変えること
- HD-2D 的な光、霧、ボケ、発光、周辺減光の演出

## 非要件(今後も守る)

- ゲームプレイ化しない
- Viewer で自由移動させない
- Blender 的な重い総合DCCにはしない
- 機能追加よりも、操作の自然さと見せ方の品質を優先する
