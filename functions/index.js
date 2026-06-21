const { onRequest, onCall, HttpsError } = require('firebase-functions/v2/https')
const admin = require('firebase-admin')
const crypto = require('crypto')

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
    const ds = a.defaultScale && a.defaultScale > 0 ? a.defaultScale : 1
    const tint = typeof a.tint === 'string' ? a.tint : null
    if (a.kind === 'glb') {
      const material = aiMaterial()
      if (tint) material.color = tint
      const o = {
        id: aiId(), name: a.name, kind: 'glb', position: [x, 0, z], rotation: [0, yaw, 0], scale: [ds, ds, ds],
        material, glbAssetId: a.hash,
      }
      if (tint) o.materialOverride = true
      // motion は undefined キーを作らない(Firestore は undefined を拒否=500 になる)
      if (turntable) o.motion = { enabled: true, moveX: 0, moveY: 0, moveZ: 0, spinY: 18, speed: 8, easing: 'linear' }
      objects.push(o)
    } else {
      const aspect = a.aspect && a.aspect > 0 ? a.aspect : 1
      const h = 1.6 * ds
      const material = Object.assign(aiMaterial(), { textureAssetId: a.hash })
      if (tint) material.color = tint
      objects.push({
        id: aiId(), name: a.name, kind: 'plane', position: [x, h / 2, z], rotation: [0, yaw, 0],
        scale: [h * aspect, h, 1], material,
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
    defaultScale: typeof a.defaultScale === 'number' && a.defaultScale > 0 ? a.defaultScale : null,
    tint: typeof a.tint === 'string' ? a.tint : null,
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

// ============================================================================
// エージェント編集API (TASK-035 / DR-2026-009): list / get / draft / place。
// すべて uid 自損スコープ・書き込み検証・上限つき。状態はクラウドのシーン doc。
// ============================================================================

const AI_MAX_OBJECTS = 300
const AI_DAILY_OP_LIMIT = 500

function aiClamp(x, lo, hi, def) {
  const n = typeof x === 'number' && isFinite(x) ? x : def
  return Math.max(lo, Math.min(hi, n))
}
function aiVec3(arr, lo, hi, def) {
  const a = Array.isArray(arr) ? arr : []
  return [aiClamp(a[0], lo, hi, def[0]), aiClamp(a[1], lo, hi, def[1]), aiClamp(a[2], lo, hi, def[2])]
}

exports.listAssets = onCall({ region: 'asia-northeast1' }, async (request) => {
  const uid = request.auth && request.auth.uid
  if (!uid) throw new HttpsError('unauthenticated', 'sign-in required')
  const snap = await admin.firestore().collection('users').doc(uid).collection('assets').get()
  const assets = snap.docs.map((d) => {
    const x = d.data() || {}
    return {
      hash: d.id,
      name: x.name || '(無題)',
      kind: x.kind === 'glb' ? 'glb' : 'image',
      aspect: typeof x.aspect === 'number' ? x.aspect : null,
      defaultScale: typeof x.defaultScale === 'number' ? x.defaultScale : null,
      tint: typeof x.tint === 'string' ? x.tint : null,
      description: typeof x.description === 'string' ? x.description : null,
      tags: Array.isArray(x.tags) ? x.tags : [],
    }
  })
  return { ok: true, assets }
})

exports.createDraftScene = onCall({ region: 'asia-northeast1' }, async (request) => {
  const uid = request.auth && request.auth.uid
  if (!uid) throw new HttpsError('unauthenticated', 'sign-in required')
  const data = request.data || {}
  const name = typeof data.name === 'string' && data.name.trim() ? data.name.trim().slice(0, 80) : '下書きシーン'
  const db = admin.firestore()
  const userRef = db.collection('users').doc(uid)
  const u = (await userRef.get()).data() || {}
  if ((u.sceneCount || 0) >= AI_SCENE_LIMIT) throw new HttpsError('resource-exhausted', 'scene limit reached')
  const eye = [0, 1.5, 7], target = [0, 1, 0]
  const shot = { id: aiId(), name: 'Auto Shot', position: eye, quaternion: lookAtQuaternion(eye, target), settings: aiCameraSettings(), focusTarget: target }
  const scene = { version: 2, name, objects: [], lights: aiLights(), effects: [], env: aiEnv(), camera: aiCameraSettings(), shots: [shot], activeShotId: shot.id }
  const docRef = userRef.collection('showcases').doc()
  const batch = db.batch()
  batch.set(docRef, { name, ownerUid: uid, scene, assetRefs: {}, updatedAt: admin.firestore.FieldValue.serverTimestamp(), createdBy: 'createDraftScene' })
  batch.set(userRef, { sceneCount: admin.firestore.FieldValue.increment(1) }, { merge: true })
  await batch.commit()
  return { ok: true, sceneId: docRef.id }
})

exports.getScene = onCall({ region: 'asia-northeast1' }, async (request) => {
  const uid = request.auth && request.auth.uid
  if (!uid) throw new HttpsError('unauthenticated', 'sign-in required')
  const sceneId = (request.data || {}).sceneId
  if (typeof sceneId !== 'string' || !sceneId) throw new HttpsError('invalid-argument', 'sceneId required')
  const snap = await admin.firestore().doc('users/' + uid + '/showcases/' + sceneId).get()
  if (!snap.exists) throw new HttpsError('not-found', 'scene not found')
  const d = snap.data() || {}
  return { ok: true, sceneId, name: d.name || '', scene: d.scene || null, assetRefs: d.assetRefs || {} }
})

/**
 * library の asset doc と配置 spec({hash,position?,rotation?,scale?})から SceneObject を作る。
 * 既定スケール(defaultScale)/色味(tint)/aspect を適用、明示の scale があれば優先。
 */
function aiBuildPlacedObject(asset, spec) {
  const hash = spec.hash
  const kind = asset.kind === 'glb' ? 'glb' : 'image'
  const aspect = typeof asset.aspect === 'number' && asset.aspect > 0 ? asset.aspect : 1
  const ds = typeof asset.defaultScale === 'number' && asset.defaultScale > 0 ? asset.defaultScale : null
  const tint = typeof asset.tint === 'string' ? asset.tint : null
  const position = aiVec3(spec.position, -50, 50, [0, 0, 0])
  const r = Array.isArray(spec.rotation) ? spec.rotation : []
  const rotation = [aiClamp(r[0], -12.6, 12.6, 0), aiClamp(r[1], -12.6, 12.6, 0), aiClamp(r[2], -12.6, 12.6, 0)]
  if (kind === 'glb') {
    const s = aiClamp(Array.isArray(spec.scale) ? spec.scale[0] : ds || 1, 0.01, 50, 1)
    const material = aiMaterial()
    if (tint) material.color = tint
    const obj = { id: aiId(), name: asset.name || 'asset', kind: 'glb', position, rotation, scale: [s, s, s], material, glbAssetId: hash }
    if (tint) obj.materialOverride = true
    return obj
  }
  const h = aiClamp(Array.isArray(spec.scale) ? spec.scale[1] : 1.6 * (ds || 1), 0.05, 50, 1.6)
  const material = Object.assign(aiMaterial(), { textureAssetId: hash })
  if (tint) material.color = tint
  return { id: aiId(), name: asset.name || 'asset', kind: 'plane', position: [position[0], position[1] || h / 2, position[2]], rotation, scale: [h * aspect, h, 1], material }
}

exports.placeAsset = onCall({ region: 'asia-northeast1' }, async (request) => {
  const uid = request.auth && request.auth.uid
  if (!uid) throw new HttpsError('unauthenticated', 'sign-in required')
  const data = request.data || {}
  const sceneId = data.sceneId
  const hash = data.hash
  if (typeof sceneId !== 'string' || !sceneId) throw new HttpsError('invalid-argument', 'sceneId required')
  if (typeof hash !== 'string' || !hash) throw new HttpsError('invalid-argument', 'hash required')

  const db = admin.firestore()
  const userRef = db.collection('users').doc(uid)
  const u = (await userRef.get()).data() || {}

  // 1日あたり書き込み操作上限(DR-2026-009 条件3)
  const today = new Date().toISOString().slice(0, 10)
  const opCount = u.aiOpDate === today ? u.aiOpCount || 0 : 0
  if (opCount >= AI_DAILY_OP_LIMIT) throw new HttpsError('resource-exhausted', 'daily operation limit reached')

  // asset が本人 library に在ること(条件1,2)
  const assetSnap = await userRef.collection('assets').doc(hash).get()
  if (!assetSnap.exists) throw new HttpsError('failed-precondition', 'asset not in your library')
  const asset = assetSnap.data() || {}

  const sceneRef = userRef.collection('showcases').doc(sceneId)
  const sceneSnap = await sceneRef.get()
  if (!sceneSnap.exists) throw new HttpsError('not-found', 'scene not found')
  const docData = sceneSnap.data() || {}
  const scene = docData.scene || {}
  const objects = Array.isArray(scene.objects) ? scene.objects : []
  if (objects.length >= AI_MAX_OBJECTS) throw new HttpsError('resource-exhausted', 'object limit reached')

  const obj = aiBuildPlacedObject(asset, data)
  objects.push(obj)
  const assetRefs = Object.assign({}, docData.assetRefs || {})
  assetRefs[hash] = asset.storagePath || 'assets/' + hash

  const batch = db.batch()
  batch.update(sceneRef, { 'scene.objects': objects, assetRefs, updatedAt: admin.firestore.FieldValue.serverTimestamp() })
  batch.set(userRef, { aiOpDate: today, aiOpCount: opCount + 1 }, { merge: true })
  await batch.commit()
  return { ok: true, sceneId, objectId: obj.id, objectCount: objects.length }
})

/**
 * 複数アセットを1コールでまとめて配置する(TASK-046)。
 * data: { sceneId, items: [{hash, position?, rotation?, scale?}] }(最大50)。
 * read-modify-write を1回で行うため lost-update が起きにくい。未所有の hash は skip。
 */
exports.placeAssets = onCall({ region: 'asia-northeast1' }, async (request) => {
  const uid = request.auth && request.auth.uid
  if (!uid) throw new HttpsError('unauthenticated', 'sign-in required')
  const data = request.data || {}
  const sceneId = data.sceneId
  const items = Array.isArray(data.items) ? data.items : []
  if (typeof sceneId !== 'string' || !sceneId) throw new HttpsError('invalid-argument', 'sceneId required')
  if (items.length === 0) throw new HttpsError('invalid-argument', 'items required')
  if (items.length > 50) throw new HttpsError('resource-exhausted', 'too many items (max 50)')

  const db = admin.firestore()
  const userRef = db.collection('users').doc(uid)
  const u = (await userRef.get()).data() || {}
  const today = new Date().toISOString().slice(0, 10)
  const opCount = u.aiOpDate === today ? u.aiOpCount || 0 : 0
  if (opCount >= AI_DAILY_OP_LIMIT) throw new HttpsError('resource-exhausted', 'daily operation limit reached')

  const sceneRef = userRef.collection('showcases').doc(sceneId)
  const sceneSnap = await sceneRef.get()
  if (!sceneSnap.exists) throw new HttpsError('not-found', 'scene not found')
  const docData = sceneSnap.data() || {}
  const scene = docData.scene || {}
  const objects = Array.isArray(scene.objects) ? scene.objects : []
  const assetRefs = Object.assign({}, docData.assetRefs || {})

  const placed = []
  const skipped = []
  for (const item of items) {
    if (!item || typeof item.hash !== 'string') continue
    if (objects.length >= AI_MAX_OBJECTS) break
    const assetSnap = await userRef.collection('assets').doc(item.hash).get()
    if (!assetSnap.exists) {
      skipped.push(item.hash)
      continue
    }
    const asset = assetSnap.data() || {}
    const obj = aiBuildPlacedObject(asset, item)
    objects.push(obj)
    assetRefs[item.hash] = asset.storagePath || 'assets/' + item.hash
    placed.push(obj.id)
  }
  if (placed.length === 0) throw new HttpsError('failed-precondition', 'no valid assets placed')

  const batch = db.batch()
  batch.update(sceneRef, { 'scene.objects': objects, assetRefs, updatedAt: admin.firestore.FieldValue.serverTimestamp() })
  batch.set(userRef, { aiOpDate: today, aiOpCount: opCount + 1 }, { merge: true })
  await batch.commit()
  return { ok: true, sceneId, objectIds: placed, placed: placed.length, skipped, objectCount: objects.length }
})

/** 1日あたり書き込み操作上限を検査し、{today, opCount} を返す(超過時は throw)。 */
async function aiCheckOpLimit(u) {
  const today = new Date().toISOString().slice(0, 10)
  const opCount = u.aiOpDate === today ? u.aiOpCount || 0 : 0
  if (opCount >= AI_DAILY_OP_LIMIT) throw new HttpsError('resource-exhausted', 'daily operation limit reached')
  return { today, opCount }
}

exports.updateObject = onCall({ region: 'asia-northeast1' }, async (request) => {
  const uid = request.auth && request.auth.uid
  if (!uid) throw new HttpsError('unauthenticated', 'sign-in required')
  const data = request.data || {}
  const sceneId = data.sceneId
  const objectId = data.objectId
  if (typeof sceneId !== 'string' || !sceneId) throw new HttpsError('invalid-argument', 'sceneId required')
  if (typeof objectId !== 'string' || !objectId) throw new HttpsError('invalid-argument', 'objectId required')

  const db = admin.firestore()
  const userRef = db.collection('users').doc(uid)
  const u = (await userRef.get()).data() || {}
  const { today, opCount } = await aiCheckOpLimit(u)

  const sceneRef = userRef.collection('showcases').doc(sceneId)
  const sceneSnap = await sceneRef.get()
  if (!sceneSnap.exists) throw new HttpsError('not-found', 'scene not found')
  const docData = sceneSnap.data() || {}
  const scene = docData.scene || {}
  const objects = Array.isArray(scene.objects) ? scene.objects : []
  const obj = objects.find((o) => o && o.id === objectId)
  if (!obj) throw new HttpsError('not-found', 'object not found')

  // position / rotation / scale のみ更新可(kind/material/参照は不変)
  if (data.position !== undefined) obj.position = aiVec3(data.position, -50, 50, obj.position || [0, 0, 0])
  if (data.rotation !== undefined) {
    const r = Array.isArray(data.rotation) ? data.rotation : []
    const cur = obj.rotation || [0, 0, 0]
    obj.rotation = [aiClamp(r[0], -12.6, 12.6, cur[0]), aiClamp(r[1], -12.6, 12.6, cur[1]), aiClamp(r[2], -12.6, 12.6, cur[2])]
  }
  if (data.scale !== undefined) {
    const s = Array.isArray(data.scale) ? data.scale : []
    const cur = obj.scale || [1, 1, 1]
    obj.scale = [aiClamp(s[0], 0.01, 50, cur[0]), aiClamp(s[1], 0.01, 50, cur[1]), aiClamp(s[2], 0.01, 50, cur[2])]
  }

  const batch = db.batch()
  batch.update(sceneRef, { 'scene.objects': objects, updatedAt: admin.firestore.FieldValue.serverTimestamp() })
  batch.set(userRef, { aiOpDate: today, aiOpCount: opCount + 1 }, { merge: true })
  await batch.commit()
  return { ok: true, sceneId, objectId, objectCount: objects.length }
})

exports.removeObject = onCall({ region: 'asia-northeast1' }, async (request) => {
  const uid = request.auth && request.auth.uid
  if (!uid) throw new HttpsError('unauthenticated', 'sign-in required')
  const data = request.data || {}
  const sceneId = data.sceneId
  const objectId = data.objectId
  if (typeof sceneId !== 'string' || !sceneId) throw new HttpsError('invalid-argument', 'sceneId required')
  if (typeof objectId !== 'string' || !objectId) throw new HttpsError('invalid-argument', 'objectId required')

  const db = admin.firestore()
  const userRef = db.collection('users').doc(uid)
  const u = (await userRef.get()).data() || {}
  const { today, opCount } = await aiCheckOpLimit(u)

  const sceneRef = userRef.collection('showcases').doc(sceneId)
  const sceneSnap = await sceneRef.get()
  if (!sceneSnap.exists) throw new HttpsError('not-found', 'scene not found')
  const docData = sceneSnap.data() || {}
  const scene = docData.scene || {}
  const objects = Array.isArray(scene.objects) ? scene.objects : []
  const next = objects.filter((o) => !(o && o.id === objectId))
  const removed = next.length !== objects.length

  const batch = db.batch()
  batch.update(sceneRef, { 'scene.objects': next, updatedAt: admin.firestore.FieldValue.serverTimestamp() })
  batch.set(userRef, { aiOpDate: today, aiOpCount: opCount + 1 }, { merge: true })
  await batch.commit()
  return { ok: true, sceneId, removed, objectCount: next.length }
})

// ---- カメラ / ライト操作 (TASK-039 / DR-2026-009) ----
const AI_MAX_LIGHTS = 16
const AI_LIGHT_KINDS = ['directional', 'point', 'spot']
const AI_LIGHT_DEFAULT_INTENSITY = { directional: 3, point: 50, spot: 80 }

/** scene doc を読んで {userRef, sceneRef, today, opCount, scene} を返す共通前処理。 */
async function aiOpenScene(uid, sceneId) {
  if (typeof sceneId !== 'string' || !sceneId) throw new HttpsError('invalid-argument', 'sceneId required')
  const db = admin.firestore()
  const userRef = db.collection('users').doc(uid)
  const u = (await userRef.get()).data() || {}
  const { today, opCount } = await aiCheckOpLimit(u)
  const sceneRef = userRef.collection('showcases').doc(sceneId)
  const snap = await sceneRef.get()
  if (!snap.exists) throw new HttpsError('not-found', 'scene not found')
  return { db, userRef, sceneRef, today, opCount, scene: (snap.data() || {}).scene || {} }
}

exports.setCamera = onCall({ region: 'asia-northeast1' }, async (request) => {
  const uid = request.auth && request.auth.uid
  if (!uid) throw new HttpsError('unauthenticated', 'sign-in required')
  const data = request.data || {}
  const { db, userRef, sceneRef, today, opCount, scene } = await aiOpenScene(uid, data.sceneId)
  const shots = Array.isArray(scene.shots) ? scene.shots : []
  const shot = shots.find((s) => s && s.id === scene.activeShotId) || shots[0]
  if (!shot) throw new HttpsError('failed-precondition', 'scene has no shot')

  const eye = data.position !== undefined ? aiVec3(data.position, -100, 100, shot.position || [0, 1.5, 7]) : shot.position || [0, 1.5, 7]
  const target = data.target !== undefined ? aiVec3(data.target, -100, 100, shot.focusTarget || [0, 1, 0]) : shot.focusTarget || [0, 1, 0]
  shot.position = eye
  shot.focusTarget = target
  shot.quaternion = lookAtQuaternion(eye, target)
  if (data.focalLength !== undefined) {
    const f = aiClamp(data.focalLength, 10, 200, 45)
    shot.settings = Object.assign(shot.settings || aiCameraSettings(), { focalLength: f })
    scene.camera = Object.assign(scene.camera || aiCameraSettings(), { focalLength: f })
  }

  const batch = db.batch()
  batch.update(sceneRef, { 'scene.shots': shots, 'scene.camera': scene.camera || aiCameraSettings(), updatedAt: admin.firestore.FieldValue.serverTimestamp() })
  batch.set(userRef, { aiOpDate: today, aiOpCount: opCount + 1 }, { merge: true })
  await batch.commit()
  return { ok: true, sceneId: data.sceneId, position: eye, target }
})

exports.addLight = onCall({ region: 'asia-northeast1' }, async (request) => {
  const uid = request.auth && request.auth.uid
  if (!uid) throw new HttpsError('unauthenticated', 'sign-in required')
  const data = request.data || {}
  const { db, userRef, sceneRef, today, opCount, scene } = await aiOpenScene(uid, data.sceneId)
  const lights = Array.isArray(scene.lights) ? scene.lights : []
  if (lights.length >= AI_MAX_LIGHTS) throw new HttpsError('resource-exhausted', 'light limit reached')

  const kind = AI_LIGHT_KINDS.includes(data.kind) ? data.kind : 'point'
  const color = typeof data.color === 'string' ? data.color : '#ffffff'
  const intensity = aiClamp(data.intensity, 0, 200, AI_LIGHT_DEFAULT_INTENSITY[kind])
  const position = aiVec3(data.position, -50, 50, [3, 4, 2])
  const light = { id: aiId(), name: data.name && String(data.name).slice(0, 40) || kind, kind, color, intensity, position, castShadow: kind !== 'point' && !!data.castShadow }
  lights.push(light)

  const batch = db.batch()
  batch.update(sceneRef, { 'scene.lights': lights, updatedAt: admin.firestore.FieldValue.serverTimestamp() })
  batch.set(userRef, { aiOpDate: today, aiOpCount: opCount + 1 }, { merge: true })
  await batch.commit()
  return { ok: true, sceneId: data.sceneId, lightId: light.id, lightCount: lights.length }
})

exports.updateLight = onCall({ region: 'asia-northeast1' }, async (request) => {
  const uid = request.auth && request.auth.uid
  if (!uid) throw new HttpsError('unauthenticated', 'sign-in required')
  const data = request.data || {}
  if (typeof data.lightId !== 'string' || !data.lightId) throw new HttpsError('invalid-argument', 'lightId required')
  const { db, userRef, sceneRef, today, opCount, scene } = await aiOpenScene(uid, data.sceneId)
  const lights = Array.isArray(scene.lights) ? scene.lights : []
  const light = lights.find((l) => l && l.id === data.lightId)
  if (!light) throw new HttpsError('not-found', 'light not found')
  if (typeof data.color === 'string') light.color = data.color
  if (data.intensity !== undefined) light.intensity = aiClamp(data.intensity, 0, 200, light.intensity)
  if (data.position !== undefined) light.position = aiVec3(data.position, -50, 50, light.position || [0, 0, 0])
  if (data.castShadow !== undefined) light.castShadow = !!data.castShadow

  const batch = db.batch()
  batch.update(sceneRef, { 'scene.lights': lights, updatedAt: admin.firestore.FieldValue.serverTimestamp() })
  batch.set(userRef, { aiOpDate: today, aiOpCount: opCount + 1 }, { merge: true })
  await batch.commit()
  return { ok: true, sceneId: data.sceneId, lightId: data.lightId }
})

exports.removeLight = onCall({ region: 'asia-northeast1' }, async (request) => {
  const uid = request.auth && request.auth.uid
  if (!uid) throw new HttpsError('unauthenticated', 'sign-in required')
  const data = request.data || {}
  if (typeof data.lightId !== 'string' || !data.lightId) throw new HttpsError('invalid-argument', 'lightId required')
  const { db, userRef, sceneRef, today, opCount, scene } = await aiOpenScene(uid, data.sceneId)
  const lights = Array.isArray(scene.lights) ? scene.lights : []
  const next = lights.filter((l) => !(l && l.id === data.lightId))
  const removed = next.length !== lights.length

  const batch = db.batch()
  batch.update(sceneRef, { 'scene.lights': next, updatedAt: admin.firestore.FieldValue.serverTimestamp() })
  batch.set(userRef, { aiOpDate: today, aiOpCount: opCount + 1 }, { merge: true })
  await batch.commit()
  return { ok: true, sceneId: data.sceneId, removed, lightCount: next.length }
})

// ---- アセットのインポート (TASK-043 / DR-2026-009): AI生成画像/GLB の取り込み ----
const AI_MAX_IMPORT_BYTES = 12 * 1024 * 1024

function aiParseDataUrl(dataUrl) {
  const m = /^data:([^;,]+)?(;base64)?,([\s\S]*)$/.exec(dataUrl || '')
  if (!m) return null
  const mime = m[1] || 'application/octet-stream'
  const buf = m[2] ? Buffer.from(m[3], 'base64') : Buffer.from(decodeURIComponent(m[3]))
  return { mime, buf }
}

/**
 * 取り込みバイトの整合性チェック。途中で切れた/壊れたアセットを弾く(truncation 対策)。
 * base64 をモデル経由で渡すと末尾が欠けることがあり、ヘッダだけ読めて中身が空のまま
 * 黙って保存されると「配置したのに見えない」になる。既知フォーマットは終端まで検証する。
 */
function aiAssetIntegrity(buf, kind) {
  const n = buf.length
  const sig = (...b) => b.every((x, i) => buf[i] === x)
  if (kind === 'glb') {
    if (!sig(0x67, 0x6c, 0x54, 0x46)) return { ok: false, why: 'GLB シグネチャ(glTF)がありません' }
    if (n < 12 || buf.readUInt32LE(8) !== n)
      return { ok: false, why: 'GLB のヘッダ宣言長とファイル長が不一致(切断の可能性)' }
    return { ok: true }
  }
  if (sig(0x89, 0x50, 0x4e, 0x47)) {
    const ok = n >= 12 && buf.subarray(n - 8).toString('hex') === '49454e44ae426082'
    return ok ? { ok: true } : { ok: false, why: 'PNG が IEND で終わっていません(切断の可能性)' }
  }
  if (sig(0xff, 0xd8, 0xff)) {
    const ok = n >= 4 && buf[n - 2] === 0xff && buf[n - 1] === 0xd9
    return ok ? { ok: true } : { ok: false, why: 'JPEG が EOI(FFD9)で終わっていません(切断の可能性)' }
  }
  if (n >= 12 && buf.subarray(0, 4).toString('ascii') === 'RIFF' && buf.subarray(8, 12).toString('ascii') === 'WEBP') {
    const ok = buf.readUInt32LE(4) === n - 8
    return ok ? { ok: true } : { ok: false, why: 'WEBP の RIFF サイズとファイル長が不一致(切断の可能性)' }
  }
  if (buf.subarray(0, 3).toString('ascii') === 'GIF') {
    const ok = buf[n - 1] === 0x3b
    return ok ? { ok: true } : { ok: false, why: 'GIF がトレーラ(0x3B)で終わっていません(切断の可能性)' }
  }
  // 既知フォーマットでなければ終端検証は不能 → 通す(空でないことは呼び出し側で担保済み)
  return { ok: true }
}

/** PNG なら IHDR から縦横比を返す(AI生成画像は大抵 PNG)。それ以外は null。 */
function aiPngAspect(buf) {
  if (buf.length > 24 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
    const w = buf.readUInt32BE(16)
    const h = buf.readUInt32BE(20)
    if (w > 0 && h > 0) return w / h
  }
  return null
}

exports.importAsset = onCall({ region: 'asia-northeast1' }, async (request) => {
  const uid = request.auth && request.auth.uid
  if (!uid) throw new HttpsError('unauthenticated', 'sign-in required')
  const data = request.data || {}
  const name = typeof data.name === 'string' && data.name.trim() ? data.name.trim().slice(0, 80) : 'asset'

  const parsed = data.dataUrl
    ? aiParseDataUrl(data.dataUrl)
    : data.base64
      ? { mime: data.contentType || 'application/octet-stream', buf: Buffer.from(data.base64, 'base64') }
      : null
  if (!parsed || !parsed.buf || !parsed.buf.length) {
    throw new HttpsError('invalid-argument', 'dataUrl (data:<mime>;base64,...) または base64 が必要')
  }
  if (parsed.buf.length > AI_MAX_IMPORT_BYTES) {
    throw new HttpsError('resource-exhausted', 'asset too large (max ~12MB)')
  }

  const isGlb = data.kind === 'glb' || /gltf|glb|octet-stream/i.test(parsed.mime)
  const kind = isGlb ? 'glb' : 'image'
  const contentType = isGlb
    ? 'model/gltf-binary'
    : /png|jpe?g|webp|gif/i.test(parsed.mime)
      ? parsed.mime.replace('jpg', 'jpeg')
      : 'image/png'

  // 切断/破損したアセットを黙って保存しない(base64 の truncation 対策)。
  const integ = aiAssetIntegrity(parsed.buf, kind)
  if (!integ.ok) throw new HttpsError('invalid-argument', '壊れたアセット: ' + integ.why)

  const db = admin.firestore()
  const userRef = db.collection('users').doc(uid)
  const u = (await userRef.get()).data() || {}
  const { today, opCount } = await aiCheckOpLimit(u)

  // content-hash(storage.ts と同じ: SHA-256 先頭16byte)。同一内容は再アップロードしない。
  const hash = crypto.createHash('sha256').update(parsed.buf).digest('hex').slice(0, 32)
  const path = 'assets/' + hash
  const file = admin.storage().bucket().file(path)
  const [exists] = await file.exists()
  if (!exists) await file.save(parsed.buf, { contentType, resumable: false })

  const aspect =
    typeof data.aspect === 'number' && data.aspect > 0
      ? data.aspect
      : kind === 'image'
        ? aiPngAspect(parsed.buf)
        : null
  const doc = { name, kind, storagePath: path, updatedAt: admin.firestore.FieldValue.serverTimestamp() }
  if (aspect) doc.aspect = aspect

  const batch = db.batch()
  batch.set(userRef.collection('assets').doc(hash), doc, { merge: true })
  batch.set(userRef, { aiOpDate: today, aiOpCount: opCount + 1 }, { merge: true })
  await batch.commit()
  return { ok: true, hash, kind, aspect: aspect || null, reused: exists }
})

// ---- 動きループ(v0.8.0)を MCP から設定 (TASK-045) ----
const AI_EASINGS = ['linear', 'easeInOut', 'easeIn', 'easeOut']

exports.setCameraMotion = onCall({ region: 'asia-northeast1' }, async (request) => {
  const uid = request.auth && request.auth.uid
  if (!uid) throw new HttpsError('unauthenticated', 'sign-in required')
  const data = request.data || {}
  const { db, userRef, sceneRef, today, opCount, scene } = await aiOpenScene(uid, data.sceneId)
  const cam = scene.camera || aiCameraSettings()
  const m = Object.assign({ enabled: true, yawDeg: 0, pitchDeg: 0, dolly: 0, speed: 8 }, cam.motion || {})
  if (data.enabled !== undefined) m.enabled = !!data.enabled
  if (data.yawDeg !== undefined) m.yawDeg = aiClamp(data.yawDeg, 0, 180, m.yawDeg)
  if (data.pitchDeg !== undefined) m.pitchDeg = aiClamp(data.pitchDeg, 0, 90, m.pitchDeg)
  if (data.dolly !== undefined) m.dolly = aiClamp(data.dolly, 0, 1, m.dolly)
  if (data.truck !== undefined) m.truck = aiClamp(data.truck, 0, 50, m.truck || 0)
  if (data.pedestal !== undefined) m.pedestal = aiClamp(data.pedestal, 0, 50, m.pedestal || 0)
  if (data.speed !== undefined) m.speed = aiClamp(data.speed, 1, 120, m.speed)
  if (AI_EASINGS.includes(data.easing)) m.easing = data.easing
  if (data.phase !== undefined) m.phase = aiClamp(data.phase, 0, 1, m.phase || 0)
  cam.motion = m
  const batch = db.batch()
  batch.update(sceneRef, { 'scene.camera': cam, updatedAt: admin.firestore.FieldValue.serverTimestamp() })
  batch.set(userRef, { aiOpDate: today, aiOpCount: opCount + 1 }, { merge: true })
  await batch.commit()
  return { ok: true, sceneId: data.sceneId, motion: m }
})

exports.setObjectMotion = onCall({ region: 'asia-northeast1' }, async (request) => {
  const uid = request.auth && request.auth.uid
  if (!uid) throw new HttpsError('unauthenticated', 'sign-in required')
  const data = request.data || {}
  if (typeof data.objectId !== 'string') throw new HttpsError('invalid-argument', 'objectId required')
  const { db, userRef, sceneRef, today, opCount, scene } = await aiOpenScene(uid, data.sceneId)
  const objects = Array.isArray(scene.objects) ? scene.objects : []
  const obj = objects.find((o) => o && o.id === data.objectId)
  if (!obj) throw new HttpsError('not-found', 'object not found')
  const m = Object.assign({ enabled: true, moveX: 0, moveY: 0, moveZ: 0, spinY: 0, speed: 6 }, obj.motion || {})
  if (data.enabled !== undefined) m.enabled = !!data.enabled
  if (data.moveX !== undefined) m.moveX = aiClamp(data.moveX, 0, 50, m.moveX)
  if (data.moveY !== undefined) m.moveY = aiClamp(data.moveY, 0, 50, m.moveY)
  if (data.moveZ !== undefined) m.moveZ = aiClamp(data.moveZ, 0, 50, m.moveZ)
  if (data.spinY !== undefined) m.spinY = aiClamp(data.spinY, -720, 720, m.spinY)
  if (data.speed !== undefined) m.speed = aiClamp(data.speed, 1, 120, m.speed)
  if (AI_EASINGS.includes(data.easing)) m.easing = data.easing
  if (data.phase !== undefined) m.phase = aiClamp(data.phase, 0, 1, m.phase || 0)
  obj.motion = m
  const batch = db.batch()
  batch.update(sceneRef, { 'scene.objects': objects, updatedAt: admin.firestore.FieldValue.serverTimestamp() })
  batch.set(userRef, { aiOpDate: today, aiOpCount: opCount + 1 }, { merge: true })
  await batch.commit()
  return { ok: true, sceneId: data.sceneId, objectId: data.objectId, motion: m }
})

exports.setLightPulse = onCall({ region: 'asia-northeast1' }, async (request) => {
  const uid = request.auth && request.auth.uid
  if (!uid) throw new HttpsError('unauthenticated', 'sign-in required')
  const data = request.data || {}
  if (typeof data.lightId !== 'string') throw new HttpsError('invalid-argument', 'lightId required')
  const { db, userRef, sceneRef, today, opCount, scene } = await aiOpenScene(uid, data.sceneId)
  const lights = Array.isArray(scene.lights) ? scene.lights : []
  const light = lights.find((l) => l && l.id === data.lightId)
  if (!light) throw new HttpsError('not-found', 'light not found')
  const p = Object.assign({ enabled: true, mode: 'pulse', min: 0.15, speed: 1.5 }, light.pulse || {})
  if (data.enabled !== undefined) p.enabled = !!data.enabled
  if (['pulse', 'blink', 'flicker'].includes(data.mode)) p.mode = data.mode
  if (data.min !== undefined) p.min = aiClamp(data.min, 0, 1, p.min)
  if (data.speed !== undefined) p.speed = aiClamp(data.speed, 0.05, 30, p.speed)
  if (AI_EASINGS.includes(data.easing)) p.easing = data.easing
  if (data.phase !== undefined) p.phase = aiClamp(data.phase, 0, 1, p.phase || 0)
  light.pulse = p
  const batch = db.batch()
  batch.update(sceneRef, { 'scene.lights': lights, updatedAt: admin.firestore.FieldValue.serverTimestamp() })
  batch.set(userRef, { aiOpDate: today, aiOpCount: opCount + 1 }, { merge: true })
  await batch.commit()
  return { ok: true, sceneId: data.sceneId, lightId: data.lightId, pulse: p }
})

exports.setLightColorCycle = onCall({ region: 'asia-northeast1' }, async (request) => {
  const uid = request.auth && request.auth.uid
  if (!uid) throw new HttpsError('unauthenticated', 'sign-in required')
  const data = request.data || {}
  if (typeof data.lightId !== 'string') throw new HttpsError('invalid-argument', 'lightId required')
  const { db, userRef, sceneRef, today, opCount, scene } = await aiOpenScene(uid, data.sceneId)
  const lights = Array.isArray(scene.lights) ? scene.lights : []
  const light = lights.find((l) => l && l.id === data.lightId)
  if (!light) throw new HttpsError('not-found', 'light not found')
  const c = Object.assign({ enabled: true, mode: 'gradient', hueRange: 60, colors: ['#ff3df0', '#3df0ff', '#f0e63d'], speed: 4 }, light.colorCycle || {})
  if (data.enabled !== undefined) c.enabled = !!data.enabled
  if (['hue', 'gradient'].includes(data.mode)) c.mode = data.mode
  if (data.hueRange !== undefined) c.hueRange = aiClamp(data.hueRange, 0, 180, c.hueRange)
  if (Array.isArray(data.colors)) {
    const cols = data.colors.filter((x) => typeof x === 'string').slice(0, 4)
    if (cols.length >= 2) c.colors = cols
  }
  if (data.speed !== undefined) c.speed = aiClamp(data.speed, 1, 120, c.speed)
  if (data.phase !== undefined) c.phase = aiClamp(data.phase, 0, 1, c.phase || 0)
  light.colorCycle = c
  const batch = db.batch()
  batch.update(sceneRef, { 'scene.lights': lights, updatedAt: admin.firestore.FieldValue.serverTimestamp() })
  batch.set(userRef, { aiOpDate: today, aiOpCount: opCount + 1 }, { merge: true })
  await batch.commit()
  return { ok: true, sceneId: data.sceneId, lightId: data.lightId, colorCycle: c }
})

// ---- 環境(地面/Grid/背景/霧 等)を MCP から設定 (TASK-051) ----
function aiColor(v, def) {
  return typeof v === 'string' && /^#[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$/.test(v) ? v : def
}

exports.setEnvironment = onCall({ region: 'asia-northeast1' }, async (request) => {
  const uid = request.auth && request.auth.uid
  if (!uid) throw new HttpsError('unauthenticated', 'sign-in required')
  const data = request.data || {}
  const { db, userRef, sceneRef, today, opCount, scene } = await aiOpenScene(uid, data.sceneId)
  const env = Object.assign(aiEnv(), scene.env || {})
  // 表示トグル
  if (data.groundVisible !== undefined) env.groundVisible = !!data.groundVisible
  if (data.gridVisible !== undefined) env.gridVisible = !!data.gridVisible
  if (data.fogEnabled !== undefined) env.fogEnabled = !!data.fogEnabled
  if (data.bloomEnabled !== undefined) env.bloomEnabled = !!data.bloomEnabled
  if (data.vignetteEnabled !== undefined) env.vignetteEnabled = !!data.vignetteEnabled
  // 色
  if (data.backgroundColor !== undefined) env.backgroundColor = aiColor(data.backgroundColor, env.backgroundColor)
  if (data.groundColor !== undefined) env.groundColor = aiColor(data.groundColor, env.groundColor)
  if (data.fogColor !== undefined) env.fogColor = aiColor(data.fogColor, env.fogColor)
  if (data.ambientColor !== undefined) env.ambientColor = aiColor(data.ambientColor, env.ambientColor)
  // 数値
  if (data.ambientIntensity !== undefined) env.ambientIntensity = aiClamp(data.ambientIntensity, 0, 3, env.ambientIntensity)
  if (data.bloomIntensity !== undefined) env.bloomIntensity = aiClamp(data.bloomIntensity, 0, 3, env.bloomIntensity)
  if (data.vignetteDarkness !== undefined) env.vignetteDarkness = aiClamp(data.vignetteDarkness, 0, 1, env.vignetteDarkness)
  if (data.fogNear !== undefined) env.fogNear = aiClamp(data.fogNear, 1, 200, env.fogNear)
  if (data.fogFar !== undefined) env.fogFar = aiClamp(data.fogFar, 5, 400, env.fogFar)
  scene.env = env
  const batch = db.batch()
  batch.update(sceneRef, { 'scene.env': env, updatedAt: admin.firestore.FieldValue.serverTimestamp() })
  batch.set(userRef, { aiOpDate: today, aiOpCount: opCount + 1 }, { merge: true })
  await batch.commit()
  return { ok: true, sceneId: data.sceneId, env }
})

// ---- シーン管理 (TASK-045) ----
exports.listScenes = onCall({ region: 'asia-northeast1' }, async (request) => {
  const uid = request.auth && request.auth.uid
  if (!uid) throw new HttpsError('unauthenticated', 'sign-in required')
  const snap = await admin.firestore().collection('users').doc(uid).collection('showcases').orderBy('updatedAt', 'desc').get()
  const scenes = snap.docs.map((d) => {
    const sc = d.get('scene') || {}
    const ts = d.get('updatedAt')
    return {
      sceneId: d.id,
      name: d.get('name') || '(無題)',
      objectCount: Array.isArray(sc.objects) ? sc.objects.length : 0,
      updatedAt: ts && ts.toMillis ? ts.toMillis() : 0,
    }
  })
  return { ok: true, scenes }
})

exports.renameScene = onCall({ region: 'asia-northeast1' }, async (request) => {
  const uid = request.auth && request.auth.uid
  if (!uid) throw new HttpsError('unauthenticated', 'sign-in required')
  const data = request.data || {}
  const sceneId = data.sceneId
  const name = typeof data.name === 'string' ? data.name.trim().slice(0, 80) : ''
  if (typeof sceneId !== 'string' || !sceneId) throw new HttpsError('invalid-argument', 'sceneId required')
  if (!name) throw new HttpsError('invalid-argument', 'name required')
  const sceneRef = admin.firestore().collection('users').doc(uid).collection('showcases').doc(sceneId)
  if (!(await sceneRef.get()).exists) throw new HttpsError('not-found', 'scene not found')
  await sceneRef.update({ name, 'scene.name': name, updatedAt: admin.firestore.FieldValue.serverTimestamp() })
  return { ok: true, sceneId, name }
})

exports.duplicateScene = onCall({ region: 'asia-northeast1' }, async (request) => {
  const uid = request.auth && request.auth.uid
  if (!uid) throw new HttpsError('unauthenticated', 'sign-in required')
  const data = request.data || {}
  const sceneId = data.sceneId
  if (typeof sceneId !== 'string' || !sceneId) throw new HttpsError('invalid-argument', 'sceneId required')
  const db = admin.firestore()
  const userRef = db.collection('users').doc(uid)
  const u = (await userRef.get()).data() || {}
  if ((u.sceneCount || 0) >= AI_SCENE_LIMIT) throw new HttpsError('resource-exhausted', 'scene limit reached')
  const src = await userRef.collection('showcases').doc(sceneId).get()
  if (!src.exists) throw new HttpsError('not-found', 'scene not found')
  const s = src.data() || {}
  const name = (typeof data.name === 'string' && data.name.trim() ? data.name.trim() : (s.name || 'シーン') + ' のコピー').slice(0, 80)
  const docRef = userRef.collection('showcases').doc()
  const batch = db.batch()
  batch.set(docRef, {
    name,
    ownerUid: uid,
    scene: Object.assign({}, s.scene, { name }),
    assetRefs: s.assetRefs || {},
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    createdBy: 'duplicateScene',
  })
  batch.set(userRef, { sceneCount: admin.firestore.FieldValue.increment(1) }, { merge: true })
  await batch.commit()
  return { ok: true, sceneId: docRef.id, name }
})

exports.deleteScene = onCall({ region: 'asia-northeast1' }, async (request) => {
  const uid = request.auth && request.auth.uid
  if (!uid) throw new HttpsError('unauthenticated', 'sign-in required')
  const data = request.data || {}
  const sceneId = data.sceneId
  if (typeof sceneId !== 'string' || !sceneId) throw new HttpsError('invalid-argument', 'sceneId required')
  const db = admin.firestore()
  const userRef = db.collection('users').doc(uid)
  const sceneRef = userRef.collection('showcases').doc(sceneId)
  if (!(await sceneRef.get()).exists) throw new HttpsError('not-found', 'scene not found')
  const batch = db.batch()
  batch.delete(sceneRef)
  batch.set(userRef, { sceneCount: admin.firestore.FieldValue.increment(-1) }, { merge: true })
  await batch.commit()
  return { ok: true, sceneId, deleted: true }
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
