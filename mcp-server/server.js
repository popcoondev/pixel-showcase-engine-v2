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

import { readFile } from 'node:fs/promises'
import { basename, extname } from 'node:path'
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
  'place_assets',
  '複数アセットを1コールでまとめて配置する(量産向け・原子的)。items=[{hash, position?, rotation?, scale?}]、最大50',
  {
    sceneId: z.string(),
    items: z.array(
      z.object({
        hash: z.string(),
        position: vec3().optional(),
        rotation: vec3().optional(),
        scale: vec3().optional(),
      }),
    ),
  },
  async (args) => asText(await call('placeAssets', args)),
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

// 拡張子→MIME。base64 を引数で渡すと truncate するため、ファイルはこちらで読む。
const MIME_BY_EXT = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf-binary',
}

server.tool(
  'import_asset_file',
  'ローカルのファイルパスから画像/GLB を取り込む(推奨)。base64 をモデル経由で渡さないので大きなファイルでも壊れない。AI 生成画像は一旦ファイルに保存してからこれで取り込むこと',
  {
    path: z.string(),
    name: z.string().optional(),
    kind: z.enum(['image', 'glb']).optional(),
  },
  async ({ path, name, kind }) => {
    let buf
    try {
      buf = await readFile(path)
    } catch (e) {
      return asText({ __error: 'read-failed', message: 'ファイルを読めません: ' + (e?.message || String(e)) })
    }
    if (!buf.length) return asText({ __error: 'invalid-argument', message: 'ファイルが空です' })
    const ext = extname(path).toLowerCase()
    const mime = MIME_BY_EXT[ext] || (kind === 'glb' ? 'model/gltf-binary' : 'application/octet-stream')
    const dataUrl = `data:${mime};base64,${buf.toString('base64')}`
    return asText(await call('importAsset', { dataUrl, name: name || basename(path), kind }))
  },
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

// --- 動きループ(v0.8.0)を設定 (TASK-045) ---
const easing = z.enum(['linear', 'easeInOut', 'easeIn', 'easeOut'])

server.tool(
  'set_camera_motion',
  'カメラを自動で動かす(オービット/弧/寄り引き/平行移動)。yawDeg=左右の弧(度0-180)、pitchDeg=上下(度0-90)、dolly=寄り引き(0-1)、truck=左右の平行移動 振幅m(0-50, 向きを保って被写体が画面内をスライド)、pedestal=上下の平行移動 m(0-50)、speed=周期秒(1-120)。enabled で有効/無効',
  {
    sceneId: z.string(),
    enabled: z.boolean().optional(),
    yawDeg: z.number().optional(),
    pitchDeg: z.number().optional(),
    dolly: z.number().optional(),
    truck: z.number().optional(),
    pedestal: z.number().optional(),
    speed: z.number().optional(),
    easing: easing.optional(),
    phase: z.number().optional(),
  },
  async (args) => asText(await call('setCameraMotion', args)),
)

server.tool(
  'set_object_motion',
  'オブジェクトをループで動かす。moveX/moveY/moveZ=各軸の振幅m(0-50, moveY=浮遊)、spinY=Y軸連続回転 度/秒(-720..720, ターンテーブル)、speed=オシレーション周期秒(1-120)',
  {
    sceneId: z.string(),
    objectId: z.string(),
    enabled: z.boolean().optional(),
    moveX: z.number().optional(),
    moveY: z.number().optional(),
    moveZ: z.number().optional(),
    spinY: z.number().optional(),
    speed: z.number().optional(),
    easing: easing.optional(),
    phase: z.number().optional(),
  },
  async (args) => asText(await call('setObjectMotion', args)),
)

server.tool(
  'set_light_pulse',
  'ライトを明滅させる。mode=pulse(柔らか)/blink(点滅)/flicker(ちらつき)、min=最小強度の割合(0-1)、speed=速さHz目安(0.05-30)、phase=位相(0-1, 別ライトと交互/連動)',
  {
    sceneId: z.string(),
    lightId: z.string(),
    enabled: z.boolean().optional(),
    mode: z.enum(['pulse', 'blink', 'flicker']).optional(),
    min: z.number().optional(),
    speed: z.number().optional(),
    easing: easing.optional(),
    phase: z.number().optional(),
  },
  async (args) => asText(await call('setLightPulse', args)),
)

server.tool(
  'set_light_color_cycle',
  'ライトの色を巡回させる(ネオン風)。mode=hue(基準色の色相を揺らす)/gradient(複数色を巡回)、hueRange=色相振れ幅 度(0-180)、colors=巡回色2〜4(gradient)、speed=周期秒(1-120)',
  {
    sceneId: z.string(),
    lightId: z.string(),
    enabled: z.boolean().optional(),
    mode: z.enum(['hue', 'gradient']).optional(),
    hueRange: z.number().optional(),
    colors: z.array(z.string()).optional(),
    speed: z.number().optional(),
    phase: z.number().optional(),
  },
  async (args) => asText(await call('setLightColorCycle', args)),
)

// --- 環境(地面/Grid/背景/霧 等) (TASK-051) ---
server.tool(
  'set_environment',
  'シーンの環境を設定する(patch: 未指定は変更しない)。groundVisible=地面の表示/非表示、gridVisible=グリッドの表示/非表示。ほかに背景色・地面色・霧(fog)・ブルーム・周辺減光・環境光も調整できる。床/グリッドを消したいときは groundVisible:false / gridVisible:false',
  {
    sceneId: z.string(),
    groundVisible: z.boolean().optional(),
    gridVisible: z.boolean().optional(),
    backgroundColor: z.string().optional(),
    groundColor: z.string().optional(),
    fogEnabled: z.boolean().optional(),
    fogColor: z.string().optional(),
    fogNear: z.number().optional(),
    fogFar: z.number().optional(),
    bloomEnabled: z.boolean().optional(),
    bloomIntensity: z.number().optional(),
    vignetteEnabled: z.boolean().optional(),
    vignetteDarkness: z.number().optional(),
    ambientColor: z.string().optional(),
    ambientIntensity: z.number().optional(),
  },
  async (args) => asText(await call('setEnvironment', args)),
)

// --- シーン全体の見せ方変換 (TASK-052) ---
server.tool(
  'set_scene_transform',
  'シーン全体(全オブジェクト)をまとめて回転/移動/スケールする演出変換。position=全体オフセットm、rotation=全体回転rad[x,y,z]、scale=等倍(0.05-20)、spinY=Y軸ターンテーブル 度/秒(Preview/公開で自動回転)。ライトは固定なので被写体だけが回る。patch(未指定は不変)',
  {
    sceneId: z.string(),
    position: vec3().optional(),
    rotation: vec3().optional(),
    scale: z.number().optional(),
    spinY: z.number().optional(),
  },
  async (args) => asText(await call('setSceneTransform', args)),
)

// --- 視点(Shot)とツアー (TASK-053) ---
server.tool(
  'add_shot',
  'カメラ視点(Shot)を追加する。position=カメラ位置m、target=注視点m(省略時 原点付近)、focalLength=焦点距離mm(10-200)。シーンを別アングルから見せる視点を 2-3 個作り、set_tour で巡らせる',
  {
    sceneId: z.string(),
    position: vec3(),
    target: vec3().optional(),
    focalLength: z.number().optional(),
    name: z.string().optional(),
  },
  async (args) => asText(await call('addShot', args)),
)

server.tool(
  'list_shots',
  'シーンの視点(Shot)一覧(id/name/position/focusTarget/focalLength)と activeShotId を返す',
  { sceneId: z.string() },
  async (args) => asText(await call('listShots', args)),
)

server.tool(
  'remove_shot',
  'シーンから視点(Shot)を削除する',
  { sceneId: z.string(), shotId: z.string() },
  async (args) => asText(await call('removeShot', args)),
)

server.tool(
  'set_tour',
  '視点ツアー(複数 Shot を自動で巡る)を設定する。enabled で有効化、shotIds=巡る順(省略時は全 shot)、dwell=各視点の静止秒(0-30)、transition=移動秒(0.1-30)、loop=ループ(既定true)。Preview/公開で再生され、シーン全体を複数アングルで見せられる',
  {
    sceneId: z.string(),
    enabled: z.boolean().optional(),
    shotIds: z.array(z.string()).optional(),
    dwell: z.number().optional(),
    transition: z.number().optional(),
    loop: z.boolean().optional(),
    easing: easing.optional(),
  },
  async (args) => asText(await call('setTour', args)),
)

// --- シーン管理 (TASK-045) ---
server.tool(
  'list_scenes',
  'アカウントの作業シーン一覧(sceneId/name/objectCount/updatedAt)を更新日時の新しい順に返す',
  {},
  async () => asText(await call('listScenes', {})),
)

server.tool(
  'rename_scene',
  '作業シーンの名前を変更する',
  { sceneId: z.string(), name: z.string() },
  async (args) => asText(await call('renameScene', args)),
)

server.tool(
  'duplicate_scene',
  '作業シーンを複製する(name 省略時は「… のコピー」)。新しい sceneId を返す',
  { sceneId: z.string(), name: z.string().optional() },
  async (args) => asText(await call('duplicateScene', args)),
)

server.tool(
  'delete_scene',
  '作業シーンを削除する(公開済みスナップショットには触れない)',
  { sceneId: z.string() },
  async (args) => asText(await call('deleteScene', args)),
)

// --- 公開 (DR-2026-010 / TASK-049): 人間承認トークン必須 ---
server.tool(
  'publish_scene',
  'シーンを /s/ 公開する。approvalToken は **人間がアプリの「エージェント公開を承認」で発行**した使い捨てトークン(対象sceneId・10分有効)。エージェントは発行できない。title/author は任意。返り値の url が公開URL',
  {
    sceneId: z.string(),
    approvalToken: z.string(),
    title: z.string().optional(),
    author: z.string().optional(),
  },
  async (args) => asText(await call('publishScene', args)),
)

server.tool(
  'unpublish_scene',
  'シーンの公開を停止する(/s/ を削除)。承認トークン不要(安全側)',
  { sceneId: z.string() },
  async (args) => asText(await call('unpublishScene', args)),
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

/** ヘッドレスで本番アプリにシーンを読み込み { browser, page } を返す(呼び出し側で close)。 */
async function openScenePage(sceneId, { shotId, mode = 'preview' } = {}) {
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
    await page.evaluate(
      ({ f, shotId, mode }) => {
        const s = window.__pse.getState()
        s.loadScene(f)
        const st = window.__pse.getState()
        // shotId 指定時はその視点を固定表示(ツアーが上書きしないよう無効化)
        if (shotId) {
          st.setTour({ enabled: false })
          st.applyShot(shotId)
        } else if (st.shots && st.shots[0]) {
          st.applyShot(st.shots[0].id)
        }
        st.setMode(mode)
      },
      { f: file, shotId: shotId || null, mode },
    )
    await page.waitForTimeout(4500) // GLB ロード + 描画待ち
    return { browser, page }
  } catch (e) {
    await browser.close()
    return { error: (e && e.message) || String(e) }
  }
}

/** sceneId のシーンを本番アプリでヘッドレス描画し、PNG(base64)を返す。 */
async function renderScene(sceneId, shotId) {
  const r = await openScenePage(sceneId, { shotId })
  if (r.error) return { error: r.error }
  const { browser, page } = r
  try {
    await page.evaluate(() => document.querySelectorAll('.help-overlay').forEach((e) => e.remove()))
    const buf = await page.locator('canvas').first().screenshot({ type: 'png' })
    return { ok: true, base64: buf.toString('base64') }
  } finally {
    await browser.close()
  }
}

/** 各オブジェクトのワールド境界ボックス寸法(m)を実シーンから測って返す。 */
async function measureScene(sceneId) {
  // edit モードで読む: motion/ターンテーブルが静止するので寸法が安定する。
  const r = await openScenePage(sceneId, { mode: 'edit' })
  if (r.error) return { error: r.error }
  const { browser, page } = r
  try {
    const result = await page.evaluate(() => {
      const fn = window.__pseMeasure
      if (typeof fn !== 'function') {
        return { __error: 'measure-unavailable', message: 'このアプリは __pseMeasure 未対応(フロントのデプロイ反映待ちの可能性)' }
      }
      return fn()
    })
    return { ok: true, result }
  } finally {
    await browser.close()
  }
}

server.tool(
  'render_scene',
  'シーンを実際にレンダリングした画像を返す(AI が見た目を確認して調整できる)。shotId を渡すとその視点から描画する(list_shots の id)',
  { sceneId: z.string(), shotId: z.string().optional() },
  async ({ sceneId, shotId }) => {
    const r = await renderScene(sceneId, shotId)
    if (r.error) {
      return { content: [{ type: 'text', text: JSON.stringify({ __error: 'render-failed', message: r.error }) }], isError: true }
    }
    return { content: [{ type: 'image', data: r.base64, mimeType: 'image/png' }] }
  },
)

server.tool(
  'measure_scene',
  '各オブジェクトの実際のサイズ(ワールド境界ボックスの幅/高さ/奥行き m)と中心、シーン全体の寸法を返す。GLB は正規化されるため scale だけでは大きさが分からない→配置の大小判断に使う',
  { sceneId: z.string() },
  async ({ sceneId }) => {
    const r = await measureScene(sceneId)
    if (r.error) {
      return { content: [{ type: 'text', text: JSON.stringify({ __error: 'measure-failed', message: r.error }) }], isError: true }
    }
    return asText(r.result)
  },
)

await server.connect(new StdioServerTransport())
console.error('pixel-showcase MCP server ready (uid=' + uid + ', region=' + region + ')')
