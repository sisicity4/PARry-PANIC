# LOUD DUNGEON: Encore (PARry-PANIC)

音楽特徴量で戦場ルールが変わる、2D見下ろしアクション（Webゲーム）です。  
Phaser 3 + TypeScript + Vite で構築した **MVP実装** を公開しています。

## このREADMEで分かること
- いま何が遊べるか
- ローカル起動手順
- 操作方法
- 実装済み/未実装の範囲
- リポジトリ公開時の注意点

## ゲーム概要
- ジャンル: 音楽駆動ローグライク・2D見下ろしアクション
- コア体験:
  - 音特徴量（bass / centroid / bpm）で敵・地形・挙動が変化
  - パリィ成功で「次の8拍」だけルール改変（Modifier）
  - 叫び（マイク）で短時間停止 + 怯ませ

## 現在の実装状況（MVP）
**実装済み**
- `MainMenu / Game / Result` の3シーン
- 固定タイムステップ更新（60Hz）
- 敵3タイプ（タンク/ラッシャー/スナイパー）の挙動差分
- 音特徴連動:
  - bass: スポーン強度・障害物密度
  - bpm: 敵速度
  - centroid: 攻撃性/演出
- 戦闘:
  - 通常/溜め攻撃（拍同期ボーナスあり）
  - パリィ（成功時に8拍Modifier + 大カウンター）
  - スタミナ消費/回復
  - 叫び（Space中のマイクゲート）
- メタ進行（localStorage）

**未実装または暫定**
- SectionDetector（サビ自動検出 + フォールバック）
- Hub + Area1..3 + BossRoom の本格マップ生成
- サビ3回連動のボス進行（現状は暫定クリア条件）

## 技術スタック
- Phaser 3
- TypeScript
- Vite
- Web Audio API
- Meyda（`spectralCentroid` / `powerSpectrum` 由来 bassEnergy）
- aubiojs（テンポ推定）

## ローカル起動
### 前提
- Node.js 20+ 推奨
- npm

### 起動
```bash
npm install
npm run dev
```

ブラウザで `http://127.0.0.1:5173` を開いてください。

### ビルド確認
```bash
npm run build
```

## Vercelデプロイ
### プレビュー（推奨）
```bash
npm run deploy:vercel:preview
```

### 本番
```bash
npm run deploy:vercel:prod
```

- `vercel.json` で Vite 向けビルド設定と `dist` 配信を固定しています。
- 初回デプロイ時はVercel CLIの認証/プロジェクト連携が求められます。

## 操作方法
- 移動: `WASD`（矢印キー対応）
- 方向: マウス
- 攻撃: 左クリック（長押しで溜め）
- パリィ: 右クリック または `Shift`
- 叫び（マイク入力ゲート）: `Space` 押下中
- フルスクリーン: `F`

## 音声・マイク挙動
- BGMは現状、コード内生成のデモ音源を再生
- マイク許可がない場合でもプレイ継続可能（叫びは無効）
- ブラウザの自動再生制約により、**最初のユーザー操作後**にAudioContextが安定起動します

## 自動テスト向けフック
以下を `window` に公開しています。
- `window.render_game_to_text()`
- `window.advanceTime(ms)`

Playwright系の検証スクリプトからゲーム状態を取得可能です。

## ディレクトリ概要
- `src/main.ts`: Phaser初期化
- `src/game/scenes/`: シーン実装
- `src/game/audio/`: AudioEngine・イベント型
- `src/game/combat/`: Modifier定義
- `src/game/persistence/`: メタ進行保存
- `src/game/core/`: ランタイム共通基盤

## 公開リポジトリとしての注意
- `.env*` は `.gitignore` 済み（`.env.example` は許可）
- APIキー/秘密情報はコミットしないでください
- 外部楽曲を同梱する場合は、配布ライセンスを必ず確認してください
- 依存ライブラリのライセンスにも従ってください

## ライセンス
このリポジトリのコードは [MIT License](./LICENSE) です。  
依存ライブラリは各ライブラリのライセンス条件に従います。
