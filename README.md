# Pixel Showcase Engine

ドット絵・GLB/GLTF・画像プレートを3D空間に配置し、固定画角の展示ビューとして見せるための Web オーサリングツールです。ゲームを作るのではなく、「置く・照らす・撮る・固定画角で見せる」を気持ちよく成立させ、**作った展示を SNS/ブログで見せられる**ことを目的にしています。

🌐 公開URL: https://pixelshowcase-7bc44.web.app

要件の詳細は [docs/requirements.md](docs/requirements.md)、設計判断は [.aof/decisions/](.aof/decisions/) を参照してください。

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

- **Edit**: オブジェクト・ライト・地面・背景の調整(GLB/GLTF は Draco / meshopt 圧縮にも対応)
- **Camera**: 構図・露出・被写界深度(実カメラ寄りの 焦点距離 / 絞り UI)
- **Preview**: 保存した Shot の固定表示。PNG 保存・動画録画 (MP4 / H.264 を優先。X 等の SNS にそのまま投稿可。非対応ブラウザは WebM)
- **Viewer**: 編集不可の固定画角表示

## クラウド保存・公開

- **☁ 保存 / 開く**: Google サインインでシーンをクラウド(Firestore + Storage)に保存し、別端末から開けます。アセットは内容ハッシュで重複排除して Storage に格納
- **Publish**: 権利確認のうえ公開すると `/s/{id}` の URL が発行され、**誰でも(サインイン不要で)固定画角プレビューを閲覧**できます。編集して再公開すると同じ URL を更新
- **動的OG**: `/s/{id}` を SNS に貼ると、作品サムネ + タイトル + 作者名のカードが展開されます(Cloud Functions `ogShowcase` が公開シーンのメタを SSR 注入)
- **退会**: アカウントと保存・公開したシーンを削除できます
- 旧 `?showcase=<slug>`(IndexedDB ローカル公開)は後方互換のため読み込みのみ対応

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
- `src/io.ts`: Scene JSON / PNG / WebM 入出力
- `src/scene/`: three.js シーン(オブジェクト、ライト、FX パーティクル、DOF/Bloom/Vignette、free-fly 操作、Draco/meshopt ローダー)
- `src/cloud/`: Firebase 連携(auth / scenes 保存 / publish 公開 / storage / account 退会)
- `src/firebase.ts`: Firebase SDK の遅延初期化 + App Check (reCAPTCHA Enterprise)
- `src/panels.tsx` / `src/CloudUI.tsx` / `src/PublishDialog.tsx` / `src/LegalModal.tsx`: UI
- `src/presets.ts`: 見せ方プリセット、`src/onboarding.ts`: 初回サンプル
- `functions/`: Cloud Functions(動的OG `ogShowcase`)
- `firestore.rules` / `storage.rules`: Security Rules

## データ形式

Scene JSON は v2 形式で、GLB / 画像の実体は内容ハッシュをキーにした `assets` テーブルに一本化しています。同じモデルを Duplicate しても実体はひとつしか保存されません。v1 形式(dataURL 直接埋め込み)の JSON も読み込み時に自動変換されます。クラウド保存時はアセットを Storage に分離し、Firestore には純 JSON + 参照を保存します。

## インフラ / 運営

- ホスティング: Firebase Hosting(main push で GitHub Actions が test → build → 自動デプロイ)
- バックエンド: Firebase Authentication / Firestore / Storage / Cloud Functions / App Check(reCAPTCHA Enterprise)
- アクセス解析: Cloudflare Web Analytics(クッキーレス・同意バナー不要)
- エラー監視: Sentry(本番のみ・エラー収集のみ)
- テスト: Vitest(`npm run test`)。CI で本番デプロイを test green でゲート
- 運用設計は AOF v2.1.0(`.aof/organization.json` / `.aof/decisions/`)に記録

## バックログ

- 複数 Shot 切替 / FX 追加(雪・煙) / モバイル Viewer のタッチ最適化
- Storage の完全削除・孤立アセット GC(Cloud Functions 基盤の上で)
