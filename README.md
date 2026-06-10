# Pixel Showcase Engine

ドット絵・GLB/GLTF・画像プレートを3D空間に配置し、固定画角の展示ビューとして見せるための Web オーサリングツールです。ゲームを作るのではなく、「置く・照らす・撮る・固定画角で見せる」を気持ちよく成立させることを目的にしています。

要件の詳細は [docs/requirements.md](docs/requirements.md) を参照してください。

## セットアップ

```bash
npm install
npm run dev
```

検証コマンド:

```bash
npm run build   # tsc -b && vite build
```

## 制作フロー

`Edit -> Camera -> Save Shot -> Preview`

- **Edit**: オブジェクト・ライト・地面・背景の調整
- **Camera**: 構図・露出・被写界深度(実カメラ寄りの 焦点距離 / 絞り UI)
- **Preview**: 保存した Shot の固定表示。PNG 保存・動画録画 (MP4 / H.264 を優先。X 等の SNS にそのまま投稿可。非対応ブラウザは WebM)
- **Viewer**: `?showcase=<slug>` で編集不可の固定画角表示(Publish で発行。保存先は IndexedDB なので GLB 複数でも容量に余裕があります)

## 基本操作

- `ESC`: Edit / Camera 切替、`F`: Camera へ
- `R`: Save Shot、`P`: Preview 切替
- 右ドラッグ / 何もない場所の左ドラッグ: パン / チルト、中ドラッグ: トラック / ペデスタル、ホイール: ドリー
- `WASD`: 移動、`Space`: 上昇、`Z / X / Ctrl`: 下降、`Shift`: 高速 (3倍)
- `Q / E`: ロール (Camera モード)。移動速度・視点感度は Camera タブで調整
- `1 / 2 / 3`: Move / Rotate / Scale、`C`: 次を選択、`Delete`: 削除
- 矢印キー: 左右 = FOV、上下 = 露出
- `Home`: Edit で視点リセット、`I`: 操作ガイド
- `Cmd/Ctrl + Z`: Undo、`Shift + Cmd/Ctrl + Z` / `Ctrl + Y`: Redo
- `Cmd/Ctrl + S`: Scene JSON 保存

## キャンバス外周クイック操作

- 下: Aperture(絞り)
- 左: FOV
- 右: Exposure(露出)

## 構成

- `src/types.ts`: Scene / Shot / Camera のデータ型
- `src/store.ts`: zustand によるアプリ状態と操作
- `src/io.ts`: Scene JSON / PNG / WebM / Publish 入出力
- `src/scene/`: three.js シーン(オブジェクト、ライト、FX パーティクル、DOF/Bloom/Vignette、free-fly 操作)
- `src/panels.tsx`: Edit / Scene / Camera / Object / Light タブの UI
- `src/App.tsx`: レイアウト、ホットキー、フッター、Viewer 表示

## データ形式

Scene JSON は v2 形式で、GLB / 画像の実体は内容ハッシュをキーにした `assets` テーブルに一本化しています。同じモデルを Duplicate しても実体はひとつしか保存されません。v1 形式(dataURL 直接埋め込み)の JSON も読み込み時に自動変換されます。

## 今後の優先拡張

1. 公開URL発行バックエンド(現状はローカル IndexedDB への Publish)
2. 展示台 / 背景 / ライトリグのプリセット
3. サムネイル自動生成
