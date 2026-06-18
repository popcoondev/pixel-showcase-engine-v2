# Pixel Showcase MCP サーバー

Pixel Showcase の**エージェント編集API**([../docs/agent-api.md](../docs/agent-api.md) / DR-2026-009)を、
**標準 MCP** で任意のクライアント(Claude Desktop / Codex / Cursor / その他)に公開する小さな
stdio サーバー。クライアントは `list_assets` / `get_scene` / `create_draft_scene` /
`place_asset` / `update_object` / `remove_object` / `compose_scene` を道具として使える。

ベンダー依存なし(標準 stdio transport + JSON Schema ツール)。

## 認証の仕組み

サービスアカウントで「自分の uid 用」の custom token をミント →
Firebase クライアント SDK が `signInWithCustomToken` → ID トークンで callable Function を叩く。
**Claude/Codex は生のトークンを見ない**(資格情報はこのプロセス内だけ)。Function 側で
uid 自損スコープ・入力検証・上限(object300 / シーン20 / 書込500/日)を強制。

## セットアップ

1. 依存をインストール:
   ```bash
   cd mcp-server && npm install
   ```

2. サービスアカウント鍵を用意(**リポジトリ外に置く**):
   Firebase Console → プロジェクト設定 → サービス アカウント → 新しい秘密鍵を生成。
   ダウンロードした JSON を安全な場所(例 `~/secrets/pse-sa.json`)に保存。

3. 自分の uid を確認:
   Firebase Console → Authentication → 対象ユーザーの **User UID**。

4. 環境変数:
   ```bash
   export GOOGLE_APPLICATION_CREDENTIALS=~/secrets/pse-sa.json
   export PSE_UID=<あなたの uid>
   # 任意: export PSE_REGION=asia-northeast1
   ```

5. 単体起動の確認(stdio なので普段はクライアントが起動する):
   ```bash
   node server.js
   # → "pixel-showcase MCP server ready (uid=...)" が stderr に出れば OK
   ```

## クライアントへの登録(例: Claude Desktop / Codex)

MCP 設定(`mcpServers`)に追加:

```json
{
  "mcpServers": {
    "pixel-showcase": {
      "command": "node",
      "args": ["/絶対パス/pixel-showcase-engine/mcp-server/server.js"],
      "env": {
        "GOOGLE_APPLICATION_CREDENTIALS": "/Users/you/secrets/pse-sa.json",
        "PSE_UID": "<あなたの uid>"
      }
    }
  }
}
```

Codex など他の MCP 対応クライアントでも、同じ `command` / `args` / `env` 形式で登録できる。

## 使い方(エージェント側のフロー例)

```
list_assets()                          // 何があるか
create_draft_scene({name:'個展A'})      // → sceneId
place_asset({sceneId, hash, position:[-2,0,0]})
place_asset({sceneId, hash2, position:[2,0,0]})
get_scene({sceneId})                   // 現状を読んで次の判断
update_object({sceneId, objectId, position:[2,0.5,0]})
```

確認・公開は人間が Web UI で(☁開く → Publish)。このサーバーは**公開しない**(作業コピーのみ)。

## 注意

- サービスアカウント JSON / `.env` はコミットしない(`.gitignore` 済 / DR-2026-009 条件6)。
- エージェントは結果を「見られない」ので、`get_scene` の構造から判断する。視覚フィードバックは将来課題。
