const { onRequest, onCall, HttpsError } = require('firebase-functions/v2/https')
const admin = require('firebase-admin')

admin.initializeApp()
// 動的生成シーンの保存で undefined フィールドが混じっても 500 にしない(値ごと無視)。
admin.firestore().settings({ ignoreUndefinedProperties: true })

/**
 * 退会: 認証ユーザー自身のデータをサーバー権威で完全削除する (TASK-019, DR-2026-007)。
 * - 公開スナップショット showcases(ownerId==uid)と、その thumbs/{id}.jpg を削除
 * - 作業シーン users/{uid}/showcases/* と counter doc を削除
 * - Auth アカウントを削除
 * assets/{hash} は content-hash 共有のためここでは消さず、孤立分は定期 GC (TASK-020) で回収。
 * uid から自分のデータのみ操作するため abuse は自損のみ。
 */
exports.purgeMyData = onCall({ region: 'asia-northeast1' }, async (request) => {
  const uid = request.auth && request.auth.uid
  if (!uid) throw new HttpsError('unauthenticated', 'sign-in required')

  const db = admin.firestore()
  const bucket = admin.storage().bucket()

  // 1. 公開スナップショット: thumbs を消してから doc を削除
  const pub = await db.collection('showcases').where('ownerId', '==', uid).get()
  for (const doc of pub.docs) {
    const thumbPath = doc.get('thumbPath')
    if (thumbPath) await bucket.file(thumbPath).delete().catch(() => {})
    await doc.ref.delete()
  }
  // 2. 作業シーン
  const mine = await db.collection('users').doc(uid).collection('showcases').get()
  for (const doc of mine.docs) await doc.ref.delete()
  // 3. counter doc
  await db.collection('users').doc(uid).delete().catch(() => {})
  // 4. Auth アカウント
  await admin.auth().deleteUser(uid)

  return { ok: true, deletedShowcases: pub.size }
})

// ============================================================================
// 外部AI/エージェント向けシーン生成 API (TASK-033 / DR-2026-008)
// 案A: この callable を信頼境界とし、ID トークンで認証・Admin 実行。
// App Check は enforce しない(プログラム的クライアントを許す)が、
// 操作は呼び出し元 uid 自身のデータのみ + 上限で濫用/コストを封じる。
// 配置規則は src/experiments/composeScene.ts と整合(three 非依存で port)。
// ============================================================================

const AI_MAX_INPUT_ASSETS = 50
const AI_DAILY_GEN_LIMIT = 20
const AI_SCENE_LIMIT = 20

const v = {
  sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
  cross: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
  len: (a) => Math.hypot(a[0], a[1], a[2]),
  norm: (a) => {
    const l = Math.hypot(a[0], a[1], a[2]) || 1
    return [a[0] / l, a[1] / l, a[2] / l]
  },
}

/** three.Matrix4.lookAt 互換のカメラ姿勢 quaternion [x,y,z,w]。 */
function lookAtQuaternion(eye, target) {
  const z = v.norm(v.sub(eye, target))
  let x = v.cross([0, 1, 0], z)
  x = v.len(x) < 1e-6 ? [1, 0, 0] : v.norm(x)
  const y = v.cross(z, x)
  const m00 = x[0], m01 = y[0], m02 = z[0]
  const m10 = x[1], m11 = y[1], m12 = z[1]
  const m20 = x[2], m21 = y[2], m22 = z[2]
  const tr = m00 + m11 + m22
  let qw, qx, qy, qz
  if (tr > 0) {
    const s = Math.sqrt(tr + 1) * 2
    qw = 0.25 * s; qx = (m21 - m12) / s; qy = (m02 - m20) / s; qz = (m10 - m01) / s
  } else if (m00 > m11 && m00 > m22) {
    const s = Math.sqrt(1 + m00 - m11 - m22) * 2
    qw = (m21 - m12) / s; qx = 0.25 * s; qy = (m01 + m10) / s; qz = (m02 + m20) / s
  } else if (m11 > m22) {
    const s = Math.sqrt(1 + m11 - m00 - m22) * 2
    qw = (m02 - m20) / s; qx = (m01 + m10) / s; qy = 0.25 * s; qz = (m12 + m21) / s
  } else {
    const s = Math.sqrt(1 + m22 - m00 - m11) * 2
    qw = (m10 - m01) / s; qx = (m02 + m20) / s; qy = (m12 + m21) / s; qz = 0.25 * s
  }
  return [qx, qy, qz, qw]
}

const aiId = () => Math.random().toString(16).slice(2, 10)
const aiMaterial = () => ({ color: '#ffffff', metalness: 0, roughness: 1, emissive: '#000000', emissiveIntensity: 0, pixelated: true })
const aiCameraSettings = () => ({ focalLength: 45, exposure: 1, dofEnabled: false, focusMode: 'subject', manualFocusDistance: 10, aperture: 2.8, aspect: '16:9' })
const aiEnv = () => ({
  backgroundColor: '#0e1018', ambientColor: '#5566aa', ambientIntensity: 0.5,
  fogEnabled: true, fogColor: '#0e1018', fogNear: 12, fogFar: 48,
  bloomEnabled: true, bloomIntensity: 0.5, vignetteEnabled: true, vignetteDarkness: 0.6,
  gridVisible: false, groundVisible: true, groundColor: '#1a1d27',
})
const aiLights = () => [
  { id: aiId(), name: 'Key', kind: 'directional', color: '#fff1de', intensity: 3.2, position: [4, 7, 5], castShadow: true },
  { id: aiId(), name: 'Fill', kind: 'directional', color: '#9fb6ff', intensity: 1.1, position: [-5, 3, 3], castShadow: false },
  { id: aiId(), name: 'Rim', kind: 'directional', color: '#ffd9a8', intensity: 1.6, position: [-2, 4, -6], castShadow: false },
]

/**
 * library アセット配列から SceneFile(assets 除く)+ assetRefs を組む。
 * 配置規則は src/experiments/composeScene.ts と一致させる。
 * assets: [{ hash, kind:'glb'|'image', name, aspect, storagePath }]
 */
function composeSceneServer(assets, opts) {
  const spacing = opts.spacing || 2.4
  const turntable = !!opts.turntable
  const n = assets.length
  const objects = []
  const assetRefs = {}
  assets.forEach((a, i) => {
    assetRefs[a.hash] = a.storagePath || 'assets/' + a.hash
    const t = n <= 1 ? 0 : i / (n - 1) - 0.5
    const x = t * spacing * Math.max(1, n - 1)
    const z = -Math.abs(t) * spacing * 0.5
    const yaw = -t * 0.6
    if (a.kind === 'glb') {
      const o = {
        id: aiId(), name: a.name, kind: 'glb', position: [x, 0, z], rotation: [0, yaw, 0], scale: [1, 1, 1],
        material: aiMaterial(), glbAssetId: a.hash,
      }
      // motion は undefined キーを作らない(Firestore は undefined を拒否=500 になる)
      if (turntable) o.motion = { enabled: true, moveX: 0, moveY: 0, moveZ: 0, spinY: 18, speed: 8, easing: 'linear' }
      objects.push(o)
    } else {
      const aspect = a.aspect && a.aspect > 0 ? a.aspect : 1
      const h = 1.6
      objects.push({
        id: aiId(), name: a.name, kind: 'plane', position: [x, h / 2, z], rotation: [0, yaw, 0],
        scale: [h * aspect, h, 1], material: Object.assign(aiMaterial(), { textureAssetId: a.hash }),
      })
    }
  })
  const width = spacing * Math.max(1, n - 1) + 1.4
  const dist = Math.max(4.5, width * 0.7 + 2.2)
  const eye = [width * 0.16, 1.5, dist]
  const target = [0, 1.0, -0.2]
  const shot = {
    id: aiId(), name: 'Auto Shot', position: eye, quaternion: lookAtQuaternion(eye, target),
    settings: aiCameraSettings(), focusTarget: target,
  }
  const scene = {
    version: 2, name: opts.name, objects, lights: aiLights(), effects: [],
    env: aiEnv(), camera: aiCameraSettings(), shots: [shot], activeShotId: shot.id,
  }
  return { scene, assetRefs }
}

/**
 * 外部からアカウントのアセットで新シーンを生成・保存する。
 * data: { name?, turntable?, assetHashes?: string[] }(assetHashes 省略=全件)
 * 戻り: { ok, sceneId, objectCount }。公開はしない(作業コピー止まり=DR 条件)。
 */
exports.createSceneFromAssets = onCall({ region: 'asia-northeast1' }, async (request) => {
  const uid = request.auth && request.auth.uid
  if (!uid) throw new HttpsError('unauthenticated', 'sign-in required')

  const data = request.data || {}
  const name = typeof data.name === 'string' && data.name.trim() ? data.name.trim().slice(0, 80) : 'AI 生成シーン'
  const turntable = !!data.turntable

  const db = admin.firestore()
  const userRef = db.collection('users').doc(uid)
  const userSnap = await userRef.get()
  const u = userSnap.exists ? userSnap.data() || {} : {}

  // 濫用/コスト上限(DR-2026-008 条件3)
  const today = new Date().toISOString().slice(0, 10)
  const genCount = u.aiGenDate === today ? u.aiGenCount || 0 : 0
  if (genCount >= AI_DAILY_GEN_LIMIT) throw new HttpsError('resource-exhausted', 'daily generation limit reached')
  if ((u.sceneCount || 0) >= AI_SCENE_LIMIT) throw new HttpsError('resource-exhausted', 'scene limit reached')

  // 自分の library のみ読む(DR-2026-008 条件2)
  const snap = await userRef.collection('assets').get()
  let assets = snap.docs.map((d) => Object.assign({ hash: d.id }, d.data() || {}))
  if (Array.isArray(data.assetHashes) && data.assetHashes.length) {
    const set = new Set(data.assetHashes)
    assets = assets.filter((a) => set.has(a.hash))
  }
  if (assets.length === 0) throw new HttpsError('failed-precondition', 'no assets in library')
  if (assets.length > AI_MAX_INPUT_ASSETS) assets = assets.slice(0, AI_MAX_INPUT_ASSETS)

  const composerInput = assets.map((a) => ({
    hash: a.hash, kind: a.kind === 'glb' ? 'glb' : 'image', name: a.name || 'asset',
    aspect: typeof a.aspect === 'number' ? a.aspect : 1, storagePath: a.storagePath || 'assets/' + a.hash,
  }))
  const { scene, assetRefs } = composeSceneServer(composerInput, { name, turntable })

  // saveSceneToCloud と同形で保存 + 上限カウンタ更新(作業コピーのみ)
  const docRef = userRef.collection('showcases').doc()
  const batch = db.batch()
  batch.set(docRef, {
    name, ownerUid: uid, scene, assetRefs,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(), createdBy: 'createSceneFromAssets',
  })
  batch.set(userRef, {
    sceneCount: admin.firestore.FieldValue.increment(1), aiGenDate: today, aiGenCount: genCount + 1,
  }, { merge: true })
  await batch.commit()

  return { ok: true, sceneId: docRef.id, objectCount: scene.objects.length }
})

const APP_ORIGIN = 'https://pixelshowcase-7bc44.web.app'
const DEFAULT_DESC = 'ドット絵・GLB・画像プレートを3D空間に置いて、固定画角の展示として見せる'

function esc(s) {
  return String(s).replace(
    /[&<>"]/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c],
  )
}

/**
 * /s/{id} の動的OG。
 * - Hosting の index.html を取得し(現行バンドル参照を保持)、
 * - 公開コレクション showcases/{id} を読んで OG/Twitter meta を <head> に注入。
 * - 人間にはそのままアプリが起動、bot は meta を読む。
 * 特権境界: 読むのは公開 showcases のみ(未公開 users/* は読まない)。
 */
exports.ogShowcase = onRequest({ region: 'asia-northeast1', cors: false }, async (req, res) => {
  let html
  try {
    html = await (await fetch(APP_ORIGIN + '/index.html')).text()
  } catch {
    res.status(502).send('app shell unavailable')
    return
  }

  const m = req.path.match(/\/s\/([\w-]+)/)
  const id = m && m[1]

  let title = 'Pixel Showcase'
  let desc = DEFAULT_DESC
  let image = null

  if (id) {
    try {
      const snap = await admin.firestore().doc('showcases/' + id).get()
      if (snap.exists) {
        const d = snap.data() || {}
        const name = d.name || 'untitled'
        title = d.ownerName ? `${name} by ${d.ownerName}` : name
        if (d.thumbUrl) image = d.thumbUrl
      }
    } catch {
      // 読めなければ既定の meta のまま返す(ページ自体は出す)
    }
  }

  const tags =
    `\n    <meta property="og:title" content="${esc(title)}">` +
    `\n    <meta property="og:description" content="${esc(desc)}">` +
    `\n    <meta property="og:type" content="website">` +
    `\n    <meta property="og:site_name" content="Pixel Showcase">` +
    (image ? `\n    <meta property="og:image" content="${esc(image)}">` : '') +
    `\n    <meta name="twitter:card" content="${image ? 'summary_large_image' : 'summary'}">` +
    `\n    <meta name="twitter:title" content="${esc(title)}">` +
    (image ? `\n    <meta name="twitter:image" content="${esc(image)}">` : '') +
    '\n  '

  // 既存の <title> も差し替え、meta を </head> 直前に注入
  html = html.replace(/<title>[^<]*<\/title>/, `<title>${esc(title)}</title>`)
  html = html.replace('</head>', tags + '</head>')

  res.set('Cache-Control', 'public, max-age=300, s-maxage=300')
  res.status(200).send(html)
})
