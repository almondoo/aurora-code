/**
 * GF(2^8) ガロア体演算
 * 原始多項式: x^8 + x^4 + x^3 + x^2 + 1 (0x11d)
 * この多項式はReed-Solomonで標準的に使用される
 */

const GF_SIZE = 256
const PRIMITIVE_POLYNOMIAL = 0x11d

// 指数テーブル: gfExp[i] = α^i (αは原始元)
const gfExp = new Uint8Array(512)

// 対数テーブル: gfLog[α^i] = i
const gfLog = new Uint8Array(256)

// テーブルの初期化
function initTables(): void {
  let x = 1
  for (let i = 0; i < 255; i++) {
    gfExp[i] = x
    gfExp[i + 255] = x // ラップアラウンド用に2倍のサイズ
    gfLog[x] = i
    x <<= 1
    if (x >= GF_SIZE) {
      x ^= PRIMITIVE_POLYNOMIAL
    }
  }
  gfLog[0] = 0 // log(0)は未定義だが便宜上0
}

// テーブル初期化を実行
initTables()

/**
 * GF(2^8)での加算 (XOR)
 */
export function gfAdd(a: number, b: number): number {
  return a ^ b
}

/**
 * GF(2^8)での減算 (XORと同じ)
 */
export function gfSub(a: number, b: number): number {
  return a ^ b
}

/**
 * GF(2^8)での乗算
 */
export function gfMul(a: number, b: number): number {
  if (a === 0 || b === 0) return 0
  return gfExp[gfLog[a] + gfLog[b]]
}

/**
 * GF(2^8)での除算
 */
export function gfDiv(a: number, b: number): number {
  if (b === 0) throw new Error('Division by zero in GF(2^8)')
  if (a === 0) return 0
  return gfExp[gfLog[a] + 255 - gfLog[b]]
}

/**
 * GF(2^8)での累乗
 */
export function gfPow(a: number, n: number): number {
  if (n === 0) return 1
  if (a === 0) return 0
  return gfExp[(gfLog[a] * n) % 255]
}

/**
 * GF(2^8)での逆元
 */
export function gfInverse(a: number): number {
  if (a === 0) throw new Error('Zero has no inverse in GF(2^8)')
  return gfExp[255 - gfLog[a]]
}

/**
 * 多項式の乗算 (係数はGF(2^8)の要素)
 * @param p - 多項式1 (係数配列、添字0が最低次)
 * @param q - 多項式2
 * @returns 積の多項式
 */
export function polyMul(p: Uint8Array, q: Uint8Array): Uint8Array {
  const result = new Uint8Array(p.length + q.length - 1)
  for (let i = 0; i < p.length; i++) {
    for (let j = 0; j < q.length; j++) {
      result[i + j] = gfAdd(result[i + j], gfMul(p[i], q[j]))
    }
  }
  return result
}

/**
 * 多項式のスカラー倍
 */
export function polyScale(p: Uint8Array, scalar: number): Uint8Array {
  const result = new Uint8Array(p.length)
  for (let i = 0; i < p.length; i++) {
    result[i] = gfMul(p[i], scalar)
  }
  return result
}

/**
 * 多項式の加算
 */
export function polyAdd(p: Uint8Array, q: Uint8Array): Uint8Array {
  const length = Math.max(p.length, q.length)
  const result = new Uint8Array(length)
  for (let i = 0; i < p.length; i++) {
    result[i] = gfAdd(result[i], p[i])
  }
  for (let i = 0; i < q.length; i++) {
    result[i] = gfAdd(result[i], q[i])
  }
  return result
}

/**
 * 多項式の評価 (ホーナー法)
 * @param p - 多項式 (係数配列、添字0が最低次)
 * @param x - 評価点
 */
export function polyEval(p: Uint8Array, x: number): number {
  let result = 0
  for (let i = p.length - 1; i >= 0; i--) {
    result = gfAdd(gfMul(result, x), p[i])
  }
  return result
}

/**
 * 生成多項式を作成
 * G(x) = (x - α^0)(x - α^1)...(x - α^(nsym-1))
 * @param nsym - パリティシンボル数
 */
export function generatorPoly(nsym: number): Uint8Array {
  let g: Uint8Array = new Uint8Array([1])
  for (let i = 0; i < nsym; i++) {
    // (x - α^i) = x + α^i (GF(2^8)では減算=加算)
    const factor: Uint8Array = new Uint8Array([gfExp[i], 1])
    g = polyMul(g, factor) as Uint8Array
  }
  return g
}

// 指数・対数テーブルのエクスポート
export { gfExp, gfLog }
