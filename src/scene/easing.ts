import type { EasingKind } from '../types'

/** u in [0,1] -> [0,1]。linear は素通し。 */
export function ease(kind: EasingKind | undefined, u: number): number {
  switch (kind) {
    case 'easeInOut':
      return u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2
    case 'easeIn':
      return u * u
    case 'easeOut':
      return 1 - (1 - u) * (1 - u)
    default:
      return u
  }
}

/**
 * 正弦オシレーション s in [-1,1] にイージングを適用して [-1,1] を返す。
 * linear/未指定は純正弦をそのまま返す(後方互換)。
 */
export function easeOsc(kind: EasingKind | undefined, s: number): number {
  if (!kind || kind === 'linear') return s
  return ease(kind, (s + 1) / 2) * 2 - 1
}
