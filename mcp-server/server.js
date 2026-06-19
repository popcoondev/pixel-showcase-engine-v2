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
admin.initializeApp({
  credential: admin.credential.applicationDefault(),
  storageBucket: firebaseConfig.storageBucket,
})
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

// 同一スキーマを使い回すと JSON Schema 生成で 2 個目以降が $ref→{} になり、
// クライアントが値を文字列化して送ってしまう。フィールドごとに新規生成する。
const vec3 = () => z.array(z.number())

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
    position: vec3().optional(),
    rotation: vec3().optional(),
    scale: vec3().optional(),
  },
  async (args) => asText(await call('placeAsset', args)),
)

server.tool(
  'update_object',
  'シーン内の既存オブジェクトの position/rotation/scale を更新する',
  {
    sceneId: z.string(),
    objectId: z.string(),
    position: vec3().optional(),
    rotation: vec3().optional(),
    scale: vec3().optional(),
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

server.tool(
  'import_asset',
  '画像/GLB をライブラリに取り込む(AI 生成画像の挿入など)。dataUrl は data:<mime>;base64,<...> 形式。取り込んだ hash を place_asset に渡せる',
  {
    dataUrl: z.string(),
    name: z.string().optional(),
    kind: z.enum(['image', 'glb']).optional(),
    aspect: z.number().optional(),
  },
  async (args) => asText(await call('importAsset', args)),
)

server.tool(
  'set_camera',
  'シーンのカメラ(アクティブShot)の位置/注視点/焦点距離を設定する',
  {
    sceneId: z.string(),
    position: vec3().optional(),
    target: vec3().optional(),
    focalLength: z.number().optional(),
  },
  async (args) => asText(await call('setCamera', args)),
)

server.tool(
  'add_light',
  'シーンにライトを追加する(kind: directional/point/spot)',
  {
    sceneId: z.string(),
    kind: z.enum(['directional', 'point', 'spot']).optional(),
    color: z.string().optional(),
    intensity: z.number().optional(),
    position: vec3().optional(),
    castShadow: z.boolean().optional(),
  },
  async (args) => asText(await call('addLight', args)),
)

server.tool(
  'update_light',
  '既存ライトの色/強さ/位置/影を更新する',
  {
    sceneId: z.string(),
    lightId: z.string(),
    color: z.string().optional(),
    intensity: z.number().optional(),
    position: vec3().optional(),
    castShadow: z.boolean().optional(),
  },
  async (args) => asText(await call('updateLight', args)),
)

server.tool(
  'remove_light',
  'シーンから指定ライトを取り除く',
  { sceneId: z.string(), lightId: z.string() },
  async (args) => asText(await call('removeLight', args)),
)

// --- 視覚フィードバック: シーンを実レンダリングして画像で返す (TASK-040) ---
const APP_URL = process.env.PSE_APP_URL || 'https://pixelshowcase-7bc44.web.app'

/** Storage の参照を署名付き URL に解決(SA 秘密鍵でローカル署名)。 */
async function signedUrl(storagePath) {
  const [url] = await admin
    .storage()
    .bucket()
    .file(storagePath)
    .getSignedUrl({ action: 'read', expires: Date.now() + 60 * 60 * 1000 })
  return url
}

/** sceneId のシーンを本番アプリでヘッドレス描画し、PNG(base64)を返す。 */
async function renderScene(sceneId) {
  let chromium
  try {
    ;({ chromium } = await import('playwright'))
  } catch {
    return { error: 'playwright 未インストール。mcp-server で `npm i playwright && npx playwright install chromium` を実行してください。' }
  }
  const data = await call('getScene', { sceneId })
  if (data.__error || !data.scene) return { error: data.message || 'getScene に失敗' }
  const assetRefs = data.assetRefs || {}
  const assets = {}
  for (const [hash, path] of Object.entries(assetRefs)) {
    try {
      assets[hash] = await signedUrl(path)
    } catch {
      /* 解決できないアセットはスキップ */
    }
  }
  const file = { ...data.scene, assets }
  // headless Chromium は既定で GPU/WebGL 無効 → R3F が描けない。SwiftShader で有効化。
  const browser = await chromium.launch({
    headless: true,
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  })
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
    await page.goto(APP_URL, { waitUntil: 'domcontentloaded' })
    await page.waitForFunction('!!(window.__pse && window.__pse.getState)', null, { timeout: 20000 })
    await page.evaluate((f) => {
      const s = window.__pse.getState()
      s.loadScene(f)
      const st = window.__pse.getState()
      if (st.shots && st.shots[0]) st.applyShot(st.shots[0].id)
      st.setMode('preview')
    }, file)
    await page.waitForTimeout(4500) // GLB ロード + 描画待ち
    await page.evaluate(() => document.querySelectorAll('.help-overlay').forEach((e) => e.remove()))
    const buf = await page.locator('canvas').first().screenshot({ type: 'png' })
    return { ok: true, base64: buf.toString('base64') }
  } finally {
    await browser.close()
  }
}

server.tool(
  'render_scene',
  'シーンを実際にレンダリングした画像を返す(AI が見た目を確認して調整できる)',
  { sceneId: z.string() },
  async ({ sceneId }) => {
    const r = await renderScene(sceneId)
    if (r.error) {
      return { content: [{ type: 'text', text: JSON.stringify({ __error: 'render-failed', message: r.error }) }], isError: true }
    }
    return { content: [{ type: 'image', data: r.base64, mimeType: 'image/png' }] }
  },
)

await server.connect(new StdioServerTransport())
console.error('pixel-showcase MCP server ready (uid=' + uid + ', region=' + region + ')')
