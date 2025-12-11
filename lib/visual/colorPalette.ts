/**
 * オーロラ風16色カラーパレット
 * 各色は4bit (0-15) のデータをエンコードする
 */

// RGB値 (0-255)
export interface RGBColor {
  r: number
  g: number
  b: number
}

// 正規化RGB値 (0-1)
export interface NormalizedRGBColor {
  r: number
  g: number
  b: number
}

/**
 * 16色オーロラパレット
 * 緑-シアン-青-紫のグラデーションで構成
 * カメラで識別しやすい色差を確保
 */
export const AURORA_PALETTE: RGBColor[] = [
  // 0x0-0x3: 深緑系（低輝度）
  { r: 20, g: 60, b: 40 },    // 0x0: ダークグリーン
  { r: 30, g: 90, b: 50 },    // 0x1: フォレストグリーン
  { r: 40, g: 120, b: 60 },   // 0x2: グリーン
  { r: 50, g: 150, b: 70 },   // 0x3: ライトグリーン

  // 0x4-0x7: シアン系（中輝度）
  { r: 40, g: 160, b: 120 },  // 0x4: ティール
  { r: 50, g: 180, b: 150 },  // 0x5: シアン
  { r: 60, g: 200, b: 180 },  // 0x6: アクア
  { r: 80, g: 220, b: 200 },  // 0x7: ライトアクア

  // 0x8-0xB: 青-紫系（中輝度）
  { r: 80, g: 140, b: 200 },  // 0x8: スカイブルー
  { r: 100, g: 120, b: 200 }, // 0x9: ブルー
  { r: 130, g: 100, b: 200 }, // 0xA: インディゴ
  { r: 160, g: 90, b: 200 },  // 0xB: バイオレット

  // 0xC-0xF: ピンク-マゼンタ系（高輝度）
  { r: 180, g: 100, b: 180 }, // 0xC: オーキッド
  { r: 200, g: 110, b: 160 }, // 0xD: ピンク
  { r: 220, g: 130, b: 150 }, // 0xE: サーモンピンク
  { r: 240, g: 160, b: 160 }, // 0xF: ライトピンク
]

/**
 * パレットを正規化 (0-1) に変換
 */
export const AURORA_PALETTE_NORMALIZED: NormalizedRGBColor[] = AURORA_PALETTE.map(
  (c) => ({
    r: c.r / 255,
    g: c.g / 255,
    b: c.b / 255,
  })
)

/**
 * シェーダー用のフラットな配列として取得
 * [r0, g0, b0, r1, g1, b1, ...]
 */
export function getPaletteForShader(): Float32Array {
  const result = new Float32Array(16 * 3)
  for (let i = 0; i < 16; i++) {
    const c = AURORA_PALETTE_NORMALIZED[i]
    result[i * 3] = c.r
    result[i * 3 + 1] = c.g
    result[i * 3 + 2] = c.b
  }
  return result
}

/**
 * ユークリッド色距離を計算
 */
export function colorDistance(c1: RGBColor, c2: RGBColor): number {
  const dr = c1.r - c2.r
  const dg = c1.g - c2.g
  const db = c1.b - c2.b
  return Math.sqrt(dr * dr + dg * dg + db * db)
}

/**
 * 加重色距離を計算（人間の視覚特性を考慮）
 * 緑に敏感、赤に次いで、青に鈍感
 */
export function weightedColorDistance(c1: RGBColor, c2: RGBColor): number {
  const dr = c1.r - c2.r
  const dg = c1.g - c2.g
  const db = c1.b - c2.b
  // 人間の視覚: G > R > B
  return Math.sqrt(dr * dr * 0.3 + dg * dg * 0.59 + db * db * 0.11)
}

/**
 * 最も近いパレットインデックスを見つける
 * @param color - 入力色 (RGB 0-255)
 * @returns パレットインデックス (0-15)
 */
export function findClosestPaletteIndex(color: RGBColor): number {
  let minDistance = Infinity
  let bestIndex = 0

  for (let i = 0; i < AURORA_PALETTE.length; i++) {
    const dist = weightedColorDistance(color, AURORA_PALETTE[i])
    if (dist < minDistance) {
      minDistance = dist
      bestIndex = i
    }
  }

  return bestIndex
}

/**
 * 色の信頼度を計算（0-1）
 * パレット色にどれだけ近いかを示す
 */
export function colorConfidence(color: RGBColor): number {
  const index = findClosestPaletteIndex(color)
  const dist = weightedColorDistance(color, AURORA_PALETTE[index])
  // 最大想定距離（対角線）は約441 (sqrt(255^2 * 3))
  // しかし加重距離では約200程度が最大
  const maxDist = 150
  return Math.max(0, 1 - dist / maxDist)
}

/**
 * パレットインデックスからRGB色を取得
 */
export function getPaletteColor(index: number): RGBColor {
  return AURORA_PALETTE[index & 0x0f]
}

/**
 * パレットインデックスから正規化RGB色を取得
 */
export function getPaletteColorNormalized(index: number): NormalizedRGBColor {
  return AURORA_PALETTE_NORMALIZED[index & 0x0f]
}

/**
 * 4bitデータを2つのパレットインデックスにエンコード
 * 上位4bitと下位4bitに分割
 */
export function byteToPaletteIndices(byte: number): [number, number] {
  return [(byte >> 4) & 0x0f, byte & 0x0f]
}

/**
 * 2つのパレットインデックスを1バイトにデコード
 */
export function paletteIndicesToByte(high: number, low: number): number {
  return ((high & 0x0f) << 4) | (low & 0x0f)
}
