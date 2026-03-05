# LOUD DUNGEON: Encore (PARry-PANIC)

音楽特徴量で戦場が変化する、Phaser 3 + TypeScript製の2D見下ろしアクションMVPです。

## 技術スタック
- Phaser 3
- TypeScript
- Vite
- Web Audio API
- Meyda（`spectralCentroid` / `bassEnergy`）
- aubiojs（テンポ推定）

## セットアップ
```bash
npm install
npm run dev
```

`http://127.0.0.1:5173` を開いてプレイします。

## 操作
- 移動: `WASD`（矢印キーも可）
- 方向: マウス
- 攻撃: 左クリック（長押しで溜め）
- パリィ: 右クリック または `Shift`
- 叫び（マイクゲート）: `Space` 押下中
- フルスクリーン: `F`

## 現状MVP範囲
- `MainMenu / Game / Result` シーン
- 固定タイムステップ更新（60Hz）
- 音特徴に連動した敵スポーン/速度/地形密度
- 溜め攻撃・パリィ・8拍Modifier・スタミナ・叫び停止
- localStorageベースのメタ進行（最小）
- `window.render_game_to_text` / `window.advanceTime` を公開（自動テスト向け）

## 公開前提メモ
- 現在のBGMはコード内生成のデモ音源です（外部音源未同梱）。
- APIキー等の秘匿情報はリポジトリに含めないでください（`.env*` はgit除外）。

## ライセンス
このリポジトリのコードは [MIT License](./LICENSE) です。
依存ライブラリはそれぞれのライセンスに従います。
