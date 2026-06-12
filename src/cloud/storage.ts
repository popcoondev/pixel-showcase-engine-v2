import { getAuthInstance, getStorageInstance } from '../firebase'

/** サインイン済みの uid を返す。未サインインなら例外。 */
export async function requireUid(): Promise<string> {
  const auth = await getAuthInstance()
  const uid = auth.currentUser?.uid
  if (!uid) throw new Error('not-signed-in')
  return uid
}

/** 実体バイトの SHA-256 (先頭16byte)。dataURL / https URL どちらでも同じ内容なら同じハッシュ。 */
async function hashBytes(buf: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', buf)
  return Array.from(new Uint8Array(digest).slice(0, 16))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

/**
 * assets(key→dataURL or https URL)を Storage assets/{contentHash} にアップロードし、
 * key→storagePath の参照表を返す。同一内容は既存をスキップ(content-hash 重複排除)。
 */
export async function uploadAssets(
  assets: Record<string, string>,
): Promise<Record<string, string>> {
  const storage = await getStorageInstance()
  const st = await import('firebase/storage')
  const assetRefs: Record<string, string> = {}
  for (const [key, url] of Object.entries(assets)) {
    const blob = await fetch(url).then((r) => r.blob())
    const hash = await hashBytes(await blob.arrayBuffer())
    const path = `assets/${hash}`
    const ref = st.ref(storage, path)
    try {
      await st.getMetadata(ref) // 既にあれば再アップロードしない
    } catch {
      await st.uploadBytes(ref, blob, { contentType: blob.type || 'application/octet-stream' })
    }
    assetRefs[key] = path
  }
  return assetRefs
}

/** assetRefs(key→storagePath)を key→ダウンロードURL に解決する(描画は URL を直接読む)。 */
export async function resolveAssetUrls(
  assetRefs: Record<string, string>,
): Promise<Record<string, string>> {
  const storage = await getStorageInstance()
  const st = await import('firebase/storage')
  const assets: Record<string, string> = {}
  for (const [key, path] of Object.entries(assetRefs)) {
    assets[key] = await st.getDownloadURL(st.ref(storage, path))
  }
  return assets
}
