// jsdom 環境に Web Crypto (subtle) が無い場合は Node の webcrypto を補う。
// store.ts の hashDataUrl が crypto.subtle.digest を使うため。
import { webcrypto } from 'node:crypto'

if (!globalThis.crypto?.subtle) {
  // @ts-expect-error: テスト環境の polyfill
  globalThis.crypto = webcrypto
}
