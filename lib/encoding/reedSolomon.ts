/**
 * Reed-Solomon エンコード/デコード
 * 消失訂正 (erasure correction) を主な用途とする
 */

import {
  gfAdd,
  gfMul,
  gfDiv,
  gfPow,
  gfInverse,
  polyMul,
  polyEval,
  generatorPoly,
  gfExp,
} from './galoisField'

/**
 * Reed-Solomon エンコード
 * @param data - 入力データ
 * @param parityCount - パリティシンボル数
 * @returns エンコードされたデータ (data + parity)
 */
export function rsEncode(data: Uint8Array, parityCount: number): Uint8Array {
  const n = data.length + parityCount
  const encoded = new Uint8Array(n)

  // データをコピー（先頭に配置）
  encoded.set(data)

  // 生成多項式を取得
  const generator = generatorPoly(parityCount)

  // 多項式除算でパリティを計算
  // msg(x) * x^parityCount mod generator(x) がパリティ
  const msgPoly = new Uint8Array(n)
  for (let i = 0; i < data.length; i++) {
    msgPoly[parityCount + i] = data[i]
  }

  // 合成除算
  for (let i = data.length - 1; i >= 0; i--) {
    const coef = msgPoly[parityCount + i]
    if (coef !== 0) {
      for (let j = 0; j < generator.length; j++) {
        msgPoly[i + j] = gfAdd(msgPoly[i + j], gfMul(generator[j], coef))
      }
    }
  }

  // パリティをコピー（末尾に配置）
  for (let i = 0; i < parityCount; i++) {
    encoded[data.length + i] = msgPoly[i]
  }

  return encoded
}

/**
 * シンドロームを計算
 * @param received - 受信データ
 * @param parityCount - パリティシンボル数
 */
function calcSyndromes(received: Uint8Array, parityCount: number): Uint8Array {
  const syndromes = new Uint8Array(parityCount)
  for (let i = 0; i < parityCount; i++) {
    syndromes[i] = polyEval(received, gfPow(2, i))
  }
  return syndromes
}

/**
 * 消失位置多項式を計算
 * Λ(x) = Π(1 - x*α^i) for each erased position i
 */
function calcErasureLocator(erasurePositions: number[]): Uint8Array {
  let locator: Uint8Array = new Uint8Array([1])
  for (const pos of erasurePositions) {
    const factor: Uint8Array = new Uint8Array([gfPow(2, pos), 1])
    locator = polyMul(locator, factor) as Uint8Array
  }
  return locator
}

/**
 * 消失値を計算 (Forney アルゴリズム)
 */
function calcErasureValues(
  syndromes: Uint8Array,
  erasurePositions: number[],
  erasureLocator: Uint8Array
): Uint8Array {
  const n = erasurePositions.length
  if (n === 0) return new Uint8Array(0)

  // オメガ多項式を計算: Ω(x) = S(x) * Λ(x) mod x^n
  const omega = new Uint8Array(n)
  for (let i = 0; i < n; i++) {
    let sum = 0
    for (let j = 0; j <= i; j++) {
      sum = gfAdd(sum, gfMul(syndromes[j], erasureLocator[i - j] || 0))
    }
    omega[i] = sum
  }

  // 各消失位置の値を計算
  const values = new Uint8Array(n)
  for (let i = 0; i < n; i++) {
    const xi = gfPow(2, erasurePositions[i])
    const xiInv = gfInverse(xi)

    // Ω(xi^-1)
    let omegaVal = 0
    for (let j = 0; j < n; j++) {
      omegaVal = gfAdd(omegaVal, gfMul(omega[j], gfPow(xiInv, j)))
    }

    // Λ'(xi^-1) - 形式微分
    let locatorDerivVal = 0
    for (let j = 1; j < erasureLocator.length; j += 2) {
      locatorDerivVal = gfAdd(
        locatorDerivVal,
        gfMul(erasureLocator[j], gfPow(xiInv, j - 1))
      )
    }

    // e_i = xi * Ω(xi^-1) / Λ'(xi^-1)
    values[i] = gfMul(xi, gfDiv(omegaVal, locatorDerivVal))
  }

  return values
}

/**
 * Reed-Solomon デコード（消失訂正）
 * @param data - 受信データ（nullは消失を示す）
 * @param dataLength - 元のデータ長（パリティを除く）
 * @param parityCount - パリティシンボル数
 * @returns デコードされたデータ、または失敗時はnull
 */
export function rsDecode(
  data: (number | null)[],
  dataLength: number,
  parityCount: number
): Uint8Array | null {
  const n = data.length

  // 消失位置を特定
  const erasurePositions: number[] = []
  for (let i = 0; i < n; i++) {
    if (data[i] === null) {
      // 位置を逆順に（多項式の添字と対応させる）
      erasurePositions.push(n - 1 - i)
    }
  }

  // 消失数がパリティ数を超えている場合は訂正不可能
  if (erasurePositions.length > parityCount) {
    return null
  }

  // 消失位置を0で埋めた受信多項式を作成
  const received = new Uint8Array(n)
  for (let i = 0; i < n; i++) {
    received[i] = data[n - 1 - i] ?? 0 // nullは0に、逆順に配置
  }

  // 消失がない場合はそのまま返す
  if (erasurePositions.length === 0) {
    const result = new Uint8Array(dataLength)
    for (let i = 0; i < dataLength; i++) {
      result[i] = received[n - 1 - i]
    }
    return result
  }

  // シンドロームを計算
  const syndromes = calcSyndromes(received, parityCount)

  // 全シンドロームが0なら訂正不要
  let allZero = true
  for (let i = 0; i < syndromes.length; i++) {
    if (syndromes[i] !== 0) {
      allZero = false
      break
    }
  }
  if (allZero) {
    const result = new Uint8Array(dataLength)
    for (let i = 0; i < dataLength; i++) {
      result[i] = received[n - 1 - i]
    }
    return result
  }

  // 消失位置多項式を計算
  const erasureLocator = calcErasureLocator(erasurePositions)

  // 消失値を計算
  const erasureValues = calcErasureValues(
    syndromes,
    erasurePositions,
    erasureLocator
  )

  // 訂正を適用
  for (let i = 0; i < erasurePositions.length; i++) {
    const pos = erasurePositions[i]
    received[pos] = gfAdd(received[pos], erasureValues[i])
  }

  // 結果を抽出（逆順を戻す）
  const result = new Uint8Array(dataLength)
  for (let i = 0; i < dataLength; i++) {
    result[i] = received[n - 1 - i]
  }

  return result
}

/**
 * シンプルなReed-Solomonエンコード（フレーム単位）
 * フレームデータにパリティを追加
 */
export function encodeWithParity(
  data: Uint8Array,
  parityCount: number
): Uint8Array {
  return rsEncode(data, parityCount)
}

/**
 * シンプルなReed-Solomonデコード（フレーム単位）
 * 欠損フレームを復元
 * @param frames - フレーム配列（nullは欠損）
 * @param dataFrameCount - データフレーム数
 * @param parityFrameCount - パリティフレーム数
 */
export function decodeFrames(
  frames: (Uint8Array | null)[],
  dataFrameCount: number,
  parityFrameCount: number
): Uint8Array[] | null {
  const totalFrames = dataFrameCount + parityFrameCount

  // フレームごとにバイト単位でデコード
  if (frames.length === 0 || frames[0] === null) {
    // 最初のフレームがnullの場合、フレームサイズが不明
    // 有効なフレームからサイズを取得
    let frameSize = 0
    for (const frame of frames) {
      if (frame !== null) {
        frameSize = frame.length
        break
      }
    }
    if (frameSize === 0) return null
  }

  const frameSize = frames.find((f) => f !== null)?.length ?? 0
  if (frameSize === 0) return null

  const result: Uint8Array[] = []

  for (let byteIdx = 0; byteIdx < frameSize; byteIdx++) {
    // 各バイト位置について、全フレームから該当バイトを収集
    const byteColumn: (number | null)[] = []
    for (let frameIdx = 0; frameIdx < totalFrames; frameIdx++) {
      const frame = frames[frameIdx]
      if (frame === null || frame.length <= byteIdx) {
        byteColumn.push(null)
      } else {
        byteColumn.push(frame[byteIdx])
      }
    }

    // Reed-Solomonデコード
    const decoded = rsDecode(byteColumn, dataFrameCount, parityFrameCount)
    if (decoded === null) {
      return null // デコード失敗
    }

    // 結果フレームに分配
    for (let frameIdx = 0; frameIdx < dataFrameCount; frameIdx++) {
      if (!result[frameIdx]) {
        result[frameIdx] = new Uint8Array(frameSize)
      }
      result[frameIdx][byteIdx] = decoded[frameIdx]
    }
  }

  return result
}
