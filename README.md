# ComfyUI-ScribblePad

ScribblePad は、**ComfyUI でプロンプトを安全に整理するための小さな作業台**です。

「ちょっと書く」「一部を無効化する」「後で再利用する」を、重くせずに回せるように作っています。

---

## できること

- ノード名: **ScribblePad**
- カテゴリ: **Utils/Text**
- 出力:
  - `cleaned_text`（コメント行を除去したテキスト）
  - `char_count`
  - `token_estimate`

### コメント行ルール

- 既定プレフィックス: `//`
- `comment_mode = loose`（既定）
  - 先頭空白を無視して `//` ならコメント扱い
- `comment_mode = strict`
  - 行頭が `//` のときだけコメント扱い
- 空行は保持（勝手に削らない）

---

## UI（CodeMirror 6 正式実装）

- CodeMirror 6 ベースの軽快な編集体験
- コメント行を薄色で表示（視認しやすい）
- プリセット保存/読込/更新/削除
- プリセット検索
- テーマ色変更（BG / FG / Comment）
- プリセットJSONのエクスポート
- `Ctrl + /`（Macは `Cmd + /`）で行コメント切替

> 注: 画面占有を減らすため、常時メトリクス表示・出力プレビューは現バージョンで省略しています。
> 注: CM6 はビルドレス運用のため ESM CDN から読み込みます（通常のネット接続環境を想定）。

---

## プリセット保存の安全設計

保存先は固定です（任意パス不可）。

`custom_nodes/ComfyUI_ScribblePad/user_data/presets.json`

制約:

- 名前: 1〜64文字
- 禁止: `/`, `\\`, `..`
- テキスト上限: 100KB

---

## インストール

ComfyUI の `custom_nodes` 配下へ:

```bash
git clone https://github.com/mrmrgty/ComfyUI-ScribblePad.git ComfyUI_ScribblePad
```

その後 ComfyUI を再起動。

---

## トークン推定について

- `token_mode=light`: 軽量推定
- `token_mode=exact`: `tiktoken` が使える環境では exact、使えない場合は自動で light にフォールバック

---

## ひとこと

ScribblePad は「派手な機能」より、**毎日触ってストレスがないこと**を優先しています。
要望があれば、堅実に育てていきます。
