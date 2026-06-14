const { onRequest, onCall, HttpsError } = require('firebase-functions/v2/https')
const admin = require('firebase-admin')

admin.initializeApp()

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
