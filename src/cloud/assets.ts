import { getDb } from '../firebase'
import type { SceneObjectDef } from '../types'
import { requireUid, resolveAssetUrls } from './storage'

export interface LibraryAsset {
  /** Storage の content-hash (= Firestore doc id, assets/{hash}) */
  hash: string
  name: string
  kind: 'glb' | 'image'
  /** ダウンロード URL(配置時はこれをアセット実体として使う) */
  url: string
}

interface AssetMeta {
  name: string
  kind: 'glb' | 'image'
}

/**
 * scene objects と assetRefs(storeKey→assets/{hash})から storageHash→メタ を導く純関数。
 * GLB は glbAssetId、画像プレートは material.textureAssetId を参照する。
 */
export function deriveAssetMeta(
  objects: SceneObjectDef[],
  assetRefs: Record<string, string>,
): Record<string, AssetMeta> {
  const hashOf = (storeKey?: string): string | null => {
    if (!storeKey) return null
    const path = assetRefs[storeKey]
    return path ? (path.split('/').pop() ?? null) : null
  }
  const out: Record<string, AssetMeta> = {}
  for (const o of objects) {
    if (o.glbAssetId) {
      const h = hashOf(o.glbAssetId)
      if (h) out[h] = { name: o.name, kind: 'glb' } // GLB 優先
    }
    const tex = o.material?.textureAssetId
    if (tex) {
      const h = hashOf(tex)
      if (h && !out[h]) out[h] = { name: o.name, kind: 'image' }
    }
  }
  return out
}

/** 保存時: scene のアセットをアカウントのライブラリ(users/{uid}/assets/{hash})に登録する。 */
export async function registerSceneAssets(
  objects: SceneObjectDef[],
  assetRefs: Record<string, string>,
): Promise<void> {
  const meta = deriveAssetMeta(objects, assetRefs)
  const hashes = Object.keys(meta)
  if (hashes.length === 0) return
  const uid = await requireUid()
  const db = await getDb()
  const fs = await import('firebase/firestore')
  const batch = fs.writeBatch(db)
  for (const h of hashes) {
    batch.set(
      fs.doc(db, 'users', uid, 'assets', h),
      {
        name: meta[h].name,
        kind: meta[h].kind,
        storagePath: `assets/${h}`,
        updatedAt: fs.serverTimestamp(),
      },
      { merge: true },
    )
  }
  await batch.commit()
}

/** アカウントのアセットライブラリ一覧(更新が新しい順)。 */
export async function listLibraryAssets(): Promise<LibraryAsset[]> {
  const uid = await requireUid()
  const db = await getDb()
  const fs = await import('firebase/firestore')
  const col = fs.collection(db, 'users', uid, 'assets')
  const snap = await fs.getDocs(fs.query(col, fs.orderBy('updatedAt', 'desc')))
  const refs: Record<string, string> = {}
  const metas: Record<string, AssetMeta> = {}
  for (const d of snap.docs) {
    const data = d.data() as { name?: string; kind?: 'glb' | 'image'; storagePath?: string }
    refs[d.id] = data.storagePath ?? `assets/${d.id}`
    metas[d.id] = { name: data.name ?? '(無題)', kind: data.kind ?? 'image' }
  }
  const urls = await resolveAssetUrls(refs)
  return snap.docs.map((d) => ({
    hash: d.id,
    name: metas[d.id].name,
    kind: metas[d.id].kind,
    url: urls[d.id],
  }))
}
