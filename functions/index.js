const { onRequest } = require('firebase-functions/v2/https')
const admin = require('firebase-admin')

admin.initializeApp()

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
