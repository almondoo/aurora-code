# Aurora Code 実装タスク

## 概要
エンコード/デコードシステムの完全再設計。文字化け問題を解決するため、情報損失のない新アーキテクチャを実装する。

## 実装ステップ

### Step 1: CRC-8チェックサム実装
- **ファイル**: `lib/encoding/crc8.ts`
- **状態**: [x] 完了
- **内容**:
  - CRC-8-CCITT アルゴリズム (多項式 0x07)
  - エクスポート: `crc8(data: Uint8Array): number`, `verifyCrc8()`

### Step 2: Reed-Solomon自前実装
- **ファイル**: `lib/encoding/galoisField.ts`, `lib/encoding/reedSolomon.ts`
- **状態**: [x] 完了
- **内容**:
  - GF(2^8) ガロア体演算（加算、乗算、除算、累乗、多項式演算）
  - 原始多項式: 0x11d
  - `rsEncode()`, `rsDecode()` - 消失訂正対応
  - `decodeFrames()` - フレーム単位のデコード

### Step 3: カラーパレット定義
- **ファイル**: `lib/visual/colorPalette.ts`
- **状態**: [x] 完了
- **内容**:
  - 16色オーロラ風パレット (緑-シアン-青-紫-ピンク)
  - `findClosestPaletteIndex()` - パレットマッチング
  - `weightedColorDistance()` - 加重色距離計算
  - `byteToPaletteIndices()`, `paletteIndicesToByte()` - 変換関数

### Step 4: フレームエンコーダー実装
- **ファイル**: `lib/encoding/frameEncoder.ts`
- **状態**: [x] 完了
- **内容**:
  - フレーム構造定義 (16バイト/フレーム)
  - `encodeData(input: string): EncodedPacket`
  - UTF-8変換 → RS縦方向エンコード → フレーム分割
  - `serializeFrame()`, `deserializeFrame()`, `verifyFrameChecksum()`

### Step 5: バンドエンコーダー実装
- **ファイル**: `lib/visual/bandEncoder.ts`
- **状態**: [x] 完了
- **内容**:
  - `frameToVisual(frame: AuroraFrame): VisualFrame`
  - `bandIndicesToUniform()` - シェーダー用データ生成
  - `bandIndicesToBytes()` - バンドインデックスからバイト復元
  - `createAnimationData()` - アニメーション制御

### Step 6: シェーダー修正
- **ファイル**: `components/AuroraCode.tsx`
- **状態**: [x] 完了
- **内容**:
  - `u_bandData[32]`, `u_frameIndex`, `u_isSyncFrame` uniform追加
  - 16色パレットによるバンドカラーレンダリング
  - オーロラ風カーテン・グロー効果維持

### Step 7: 画像検出アルゴリズム実装
- **ファイル**: `lib/detection/detector.ts`
- **状態**: [x] 完了
- **内容**:
  - `findAuroraRegion()` - オーロラ領域検出
  - `extractBandColors()` - 32バンド色抽出
  - `matchBandsToPalette()` - パレットマッチング
  - `detectFrame()` - フレーム検出＆チェックサム検証

### Step 8: フレームデコーダー実装
- **ファイル**: `lib/detection/decoder.ts`
- **状態**: [x] 完了
- **内容**:
  - `FrameDecoder` クラス - フレーム収集・状態管理
  - `addFrame()`, `getProgress()`, `decode()`
  - RS デコード統合（欠損復元）
  - UTF-8 復元＆パディング除去

### Step 9: コンポーネント統合
- **ファイル**: `components/AuroraCode.tsx`
- **状態**: [x] 完了
- **内容**:
  - 新しいlib/のインポート追加
  - 表示側: `encodeData()` + `frameToVisual()` + `bandIndicesToUniform()`
  - スキャン側: `detectFrame()` + `FrameDecoder`
  - 古いユーティリティ関数を削除
  - UI表示を新しい進捗に対応

### Step 10: テスト・調整
- **状態**: [x] 完了
- **内容**:
  - TypeScript型エラー修正（Uint8Array型キャスト）
  - 開発サーバーでの動作確認完了
  - ビルド時のNext.js 16 prerender警告（`/_not-found`）は既知の問題で、アプリケーション動作には影響なし

## 完了履歴

- 2024-XX: 全ステップ完了
  - 新エンコード/デコードシステム実装完了
  - Reed-Solomon誤り訂正（自前実装）
  - 32バンドカラーエンコーディング
  - カメラ検出アルゴリズム
  - フレームベースのデータ送受信
