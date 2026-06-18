#!/usr/bin/env node
// 標準 MCP サーバー (DR-2026-009 / TASK-036)。
// Pixel Showcase のエージェント編集API(callable Functions)を、
// 任意の MCP クライアント(Claude Desktop / Codex / その他)に stdio で公開する。
//
// 認証: サービスアカウントで自分の uid 用 custom token をミント →
//        Firebase クライアントSDK で signInWithCustomToken → ID トークンで callable を叩く。
//        Claude/Codex は生のトークンを一切見ない(資格情報はこのプロセス内だけ)。
//
// 必要な環境変数:
//   GOOGLE_APPLICATION_CREDENTIALS = サービスアカウント JSON のパス(リポジトリ外)
//   PSE_UID                        = 操作するアカウントの Firebase uid
// 任意:
//   PSE_REGION (既定 asia-northeast1)

import admin from 'firebase-admin'
import { initializeApp } from 'firebase/app'
import { getAuth, signInWithCustomToken } from 'firebase/auth'
import { getFunctions, httpsCallable } from 'firebase/functions'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'

// 公開 web config(秘密ではない)
const firebaseConfig = {
  apiKey: 'AIzaSyDzsAv1PTkD7KKJFJOC74HrmudXKUbE1Ww',
  authDomain: 'pixelshowcase-7bc44.firebaseapp.com',
  projectId: 'pixelshowcase-7bc44',
  storageBucket: 'pixelshowcase-7bc44.firebasestorage.app',
  messagingSenderId: '498699227586',
  appId: '1:498699227586:web:d5e0620f5dd5fc9687865b',
}

const uid = process.env.PSE_UID
if (!uid) {
  console.error('PSE_UID を設定してください(操作するアカウントの Firebase uid)。')
  process.exit(1)
}
const region = process.env.PSE_REGION || 'asia-northeast1'

// --- 認証ブートストラップ ---
admin.initializeApp({ credential: admin.credential.applicationDefault() })
const customToken = await admin.auth().createCustomToken(uid)
const app = initializeApp(firebaseConfig)
const auth = getAuth(app)
await signInWithCustomToken(auth, customToken)
const functions = getFunctions(app, region)

/** callable を呼んで data を返す。HttpsError は { __error } で返す(エージェントが読める)。 */
async function call(name, payload) {
  try {
    const res = await httpsCallable(functions, name)(payload || {})
    return res.data
  } catch (e) {
    return { __error: e?.code || 'internal', message: e?.message || String(e) }
  }
}

function asText(obj) {
  const isError = obj && typeof obj === 'object' && '__error' in obj
  return { content: [{ type: 'text', text: JSON.stringify(obj, null, 2) }], isError: !!isError }
}

// --- MCP サーバー ---
const server = new McpServer({ name: 'pixel-showcase', version: '0.1.0' })

const vec3 = z.array(z.number()).length(3)

server.tool(
  'list_assets',
  'アカウントに登録済みのアセット一覧(GLB/画像)を返す',
  {},
  async () => asText(await call('listAssets', {})),
)

server.tool(
  'get_scene',
  '作業シーンの現在の状態(objects/lights/camera 等)を返す',
  { sceneId: z.string() },
  async ({ sceneId }) => asText(await call('getScene', { sceneId })),
)

server.tool(
  'create_draft_scene',
  '空の下書きシーン(三灯ライト+環境+カメラ付き)を作り sceneId を返す',
  { name: z.string().optional() },
  async ({ name }) => asText(await call('createDraftScene', { name })),
)

server.tool(
  'place_asset',
  'ライブラリのアセット(hash)をシーンに1個配置する。position/rotation/scale は任意',
  {
    sceneId: z.string(),
    hash: z.string(),
    position: vec3.optional(),
    rotation: vec3.optional(),
    scale: vec3.optional(),
  },
  async (args) => asText(await call('placeAsset', args)),
)

server.tool(
  'update_object',
  'シーン内の既存オブジェクトの position/rotation/scale を更新する',
  {
    sceneId: z.string(),
    objectId: z.string(),
    position: vec3.optional(),
    rotation: vec3.optional(),
    scale: vec3.optional(),
  },
  async (args) => asText(await call('updateObject', args)),
)

server.tool(
  'remove_object',
  'シーンから指定オブジェクトを取り除く',
  { sceneId: z.string(), objectId: z.string() },
  async (args) => asText(await call('removeObject', args)),
)

server.tool(
  'compose_scene',
  'アセットから一括で下書きシーンを自動生成する(配置を任せたいとき)',
  {
    name: z.string().optional(),
    turntable: z.boolean().optional(),
    assetHashes: z.array(z.string()).optional(),
  },
  async (args) => asText(await call('createSceneFromAssets', args)),
)

await server.connect(new StdioServerTransport())
console.error('pixel-showcase MCP server ready (uid=' + uid + ', region=' + region + ')')
